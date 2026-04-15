"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { logger } from "../utils/logger";
import { v } from "convex/values";
import { julesAgent, resolveLanguageModel } from "../agent/instance";
import { chunkHtml } from "./utils";
import { withRetry, isNonRetriableError } from "../utils/retry";
import { INITIAL_CONFIG, isConfigured } from "../config/initial";
import { formatTelegramMessage, stripMdv2, chunkMessage, escapeMdv2 } from "../utils/telegramFormat";

const MAX_BACKOFF_DELAY_MS = 60_000;
const BASE_RETRY_DELAY_MS = 5_000;

function getBackoffDelayMs(consecutiveFailures: number): number {
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, Math.max(0, consecutiveFailures - 1));
  return Math.min(delay, MAX_BACKOFF_DELAY_MS);
}

async function telegramApiCall(endpoint: string, body: object): Promise<any> {
  const botToken = INITIAL_CONFIG.telegramBotToken;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set in initial.ts");

  return await withRetry(
    async () => {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        const error: any = new Error(
          `Telegram API error: ${response.status} ${err}`,
        );
        error.status = response.status;
        error.response = response;
        throw error;
      }

      return response.json();
    },
    {
      maxAttempts: 4,
      baseDelayMs: 1000,
      isRetriable: (e) => e?.status === 429 || e?.status >= 500,
    },
  );
}

async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: "HTML" | "MarkdownV2" = "MarkdownV2",
): Promise<void> {
  try {
    await telegramApiCall("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    });
  } catch (error: any) {
    // If MarkdownV2 parse fails, fall back to plain text
    if (parseMode === "MarkdownV2" && 
        (error?.message?.toLowerCase().includes("parse") || 
         error?.message?.toLowerCase().includes("markdown"))) {
      logger.warn(`MarkdownV2 parse failed, falling back to plain text: ${error.message}`);
      await telegramApiCall("sendMessage", {
        chat_id: chatId,
        text: stripMdv2(text),
        parse_mode: undefined,
      });
    } else {
      throw error;
    }
  }
}

async function sendTelegramChatAction(
  chatId: string,
  action: "typing" | "cancel",
): Promise<void> {
  await telegramApiCall("sendChatAction", {
    chat_id: chatId,
    action,
  });
}

async function sendTelegramDocument(
  chatId: string,
  fileBuffer: Buffer,
  filename: string,
  caption?: string,
): Promise<void> {
  const botToken = INITIAL_CONFIG.telegramBotToken;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set in initial.ts");

  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("caption", caption || "");
  formData.append(
    "document",
    new Blob([new Uint8Array(fileBuffer).buffer]) as any,
    filename,
  );

  await withRetry(
    async () => {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        {
          method: "POST",
          body: formData as any,
        },
      );

      if (!response.ok) {
        const err = await response.text();
        const error: any = new Error(
          `Telegram API error: ${response.status} ${err}`,
        );
        error.status = response.status;
        error.response = response;
        throw error;
      }
    },
    {
      maxAttempts: 4,
      baseDelayMs: 1000,
      isRetriable: (e) => e?.status === 429 || e?.status >= 500,
    },
  );
}

async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const botToken = INITIAL_CONFIG.telegramBotToken;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN not set in initial.ts");

  const fileData = await telegramApiCall("getFile", { file_id: fileId });

  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error("Failed to get file path from Telegram");
  }

  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;

  return await withRetry(
    async () => {
      const response = await fetch(fileUrl);

      if (!response.ok) {
        const error: any = new Error(
          `Failed to download file: ${response.statusText}`,
        );
        error.status = response.status;
        error.response = response;
        throw error;
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1000,
      isRetriable: (e) => e?.status === 429 || e?.status >= 500,
    },
  );
}

export async function processTelegramUpdate(
  ctx: any,
  update: any,
): Promise<{
  success: boolean;
  handled?: boolean;
  threadId?: string;
  error?: string;
}> {
  try {
    if (update.callback_query) {
      await processTelegramCallbackQuery(ctx, update.callback_query);
      return { success: true, handled: true };
    }

    const message = update.message || update.channel_post;

    if (!message) {
      return { success: true, handled: false };
    }

    const chatId = String(message.chat.id);
    const text = message.text || "";

    const existingUser = await ctx.runQuery(
      internal.users.db.getAnyExistingUser,
    );
    if (existingUser && existingUser.telegramChatId !== chatId) {
      await sendTelegramMessage(
        chatId,
        "⛔ *Bot Already Claimed*\n\nThis bot is already connected to another user. Each deployment can only have one owner.",
      );
      return { success: true, handled: true };
    }

    const isConnectCommand =
      text.startsWith("/connect") || text.startsWith("/start");

    try {
      // Check singleton bot config (saves DB read)
      const botConfig = await ctx.runQuery(
        internal.config.botConfig.getConfig,
        {},
      );

      let justSeeded = false;

      // Check if bot config is empty and auto-initialize from env if available
      if (!botConfig && isConfigured(INITIAL_CONFIG)) {
        await ctx.runMutation(internal.config.botConfig.updateConfig, {
          julesApiKey: INITIAL_CONFIG.julesApiKey,
          exaApiKey: INITIAL_CONFIG.exaApiKey,
          providerConfig: {
            endpoint: INITIAL_CONFIG.llmEndpoint,
            model: INITIAL_CONFIG.llmModel,
            apiKey: INITIAL_CONFIG.llmApiKey,
            sdkType: INITIAL_CONFIG.llmSdkType,
          },
        });
        justSeeded = true;
      }

      // Re-fetch after potential init
      const finalConfig = botConfig || await ctx.runQuery(
        internal.config.botConfig.getConfig,
        {},
      );

      if (!finalConfig || (!finalConfig.providerConfig && !finalConfig.julesApiKey)) {
        if (!isConnectCommand) {
          await sendTelegramMessage(
            chatId,
            "👋 *Welcome!*\n\nPlease use /connect to set your API keys in the settings page.",
          );
          return { success: true, handled: true };
        }
      }

      if (!isConnectCommand && !justSeeded) {
        if (!finalConfig?.providerConfig) {
          await sendTelegramMessage(
            chatId,
            "👋 *Welcome!*\n\nPlease use /connect to configure your LLM provider in the settings page.",
          );
          return { success: true, handled: true };
        }
        if (!finalConfig?.julesApiKey) {
          await sendTelegramMessage(
            chatId,
            "🔑 *Jules API Key Required*\n\nI need a Jules API key to manage your coding sessions. Please use /connect to set it up in the settings page.",
          );
          return { success: true, handled: true };
        }
      }
    } catch (error) {
      logger.error("[telegram] Onboarding check failed:", error);
    }

    if (message.document) {
      const fileId = message.document.file_id;
      const fileName = message.document.file_name || "unknown_file";
      const caption = message.caption;
      const size = message.document.file_size || 0;

      const maxSizeBytes = 20 * 1024 * 1024;
      if (size > maxSizeBytes) {
        await sendTelegramMessage(
          chatId,
          `File "${fileName}" exceeds the 20MB limit.`,
        );
        return { success: true, handled: true };
      }

      await ctx.runAction(internal.api.telegram.downloadAndStoreFile, {
        telegramChatId: chatId,
        fileId,
        fileName,
        caption,
        size,
      });

      return { success: true, handled: true };
    }

    const threadId = await ctx.runMutation(
      internal.users.db.getOrCreateUserThread,
      {
        telegramChatId: chatId,
      },
    );

    const isCommand = text.startsWith("/");
    if (isCommand) {
      const handled = await handleTelegramCommand(ctx, chatId, text, threadId);
      if (handled) return { success: true, handled: true, threadId };
    }

    await queueMessage(ctx, chatId, text, threadId);

    return { success: true, handled: true, threadId };
  } catch (error) {
    logger.error("[processTelegramUpdate] ERROR:", error);
    return { success: false, error: String(error) };
  }
}

async function handleTelegramCommand(
  ctx: any,
  chatId: string,
  text: string,
  threadId: string,
): Promise<boolean> {
  const command = text.split(/\s+/)[0]?.toLowerCase();

  switch (command) {
    case "/start":
      await sendTelegramMessage(
        chatId,
        "👋 *Welcome!*\n\nI'm your coding assistant. Use /connect to set your API keys and let's get started.",
      );
      return true;

    case "/help":
      await sendTelegramMessage(
        chatId,
        "📖 *Jules Dispatch Help*\n\n" +
          "/connect - Set your API keys\n" +
          "/new - Start fresh conversation (keeps memory)\n" +
          "/reset - Clear conversation only (keeps memory)\n" +
          "/compact - Summarize older messages to save context\n" +
          "/nuke - Nuclear: wipe ALL data (memory, tasks, files)\n" +
          "/start - Show welcome message\n\n" +
          "Simply send me a message or a file to get started!",
      );
      return true;

    case "/connect": {
      const token = await ctx.runMutation(internal.users.db.createAuthSession, {
        telegramChatId: chatId,
      });
      const siteUrl =
        process.env.CONVEX_SITE_URL || "https://aware-pheasant-429.convex.site";
      const settingsUrl = `${siteUrl}/settings?token=${token}`;
      await sendTelegramMessage(
        chatId,
        `🔗 *Set API keys*\n\nUse this link to set your API keys:\n\n${settingsUrl}\n\n_Expires in 24 hours._`,
      );
      return true;
    }

    case "/new":
      await sendTelegramMessage(
        chatId,
        "🆕 *Starting fresh...* New conversation thread created. Your memory and user profile are preserved.",
      );
      await ctx.scheduler.runAfter(
        0,
        internal.users.actions.cycleThreadAction,
        {
          telegramChatId: chatId,
        },
      );
      return true;

    case "/reset":
      await sendTelegramMessage(
        chatId,
        "🔄 *Resetting conversation...* Keeping your memory and user profile.",
      );
      await ctx.scheduler.runAfter(
        0,
        internal.users.actions.cycleThreadAction,
        {
          telegramChatId: chatId,
        },
      );
      return true;

    case "/nuke":
      await telegramApiCall("sendMessage", {
        chat_id: chatId,
        text: "⚠️ *Nuke All Data*\n\nThis will permanently delete ALL memory, tasks, files, and conversation history. Your API keys will be kept.\n\nAre you sure?",
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Yes, nuke everything",
                callback_data: "nuke_confirm",
              },
              { text: "Cancel", callback_data: "nuke_cancel" },
            ],
          ],
        },
      });
      return true;

    case "/compact":
      await sendTelegramMessage(
        chatId,
        "🧹 *Compacting conversation...*\n\nFirst saving important facts, then summarizing older messages.",
      );
      // memoryFlush runs fact-saving then compaction sequentially
      await ctx.scheduler.runAfter(0, internal.memory.compaction.memoryFlush, {
        threadId,
        telegramChatId: chatId,
      });
      return true;

    default:
      if (text.startsWith("/")) {
        await sendTelegramMessage(
          chatId,
          "❓ *Unknown command.*\n\nType /help for a list of available commands.",
        );
        return true;
      }
      return false;
  }
}

async function processTelegramCallbackQuery(ctx: any, query: any) {
  const chatId = String(query.message.chat.id);
  const messageId = query.message.message_id;
  const data = query.data;

  if (data === "nuke_confirm") {
    await telegramApiCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "☢️ *Nuking all data...* Please wait.",
      parse_mode: "MarkdownV2",
    });

    await ctx.scheduler.runAfter(0, internal.users.actions.nukeUserAction, {
      telegramChatId: chatId,
    });

    await sendTelegramMessage(
      chatId,
      "✅ *System Reset Complete.* All memories and threads have been deleted. API keys preserved.",
    );
  } else if (data === "nuke_cancel") {
    await telegramApiCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "❌ *Reset Cancelled.* No data was deleted.",
      parse_mode: "MarkdownV2",
    });
  }

  await telegramApiCall("answerCallbackQuery", {
    callback_query_id: query.id,
  });
}

const QUEUE_CAP = 100;
const QUEUE_CAP_WARNING_THRESHOLD = 99;

async function queueMessage(
  ctx: any,
  telegramChatId: string,
  text: string,
  threadId: string,
): Promise<void> {
  // Check queue depth before appending
  const queueDepth = await ctx.runQuery(internal.users.db.getQueueDepth, {
    threadId,
  });
  
  // If queue is at or exceeds cap, drop oldest messages
  if (queueDepth >= QUEUE_CAP) {
    const result = await ctx.runMutation(internal.users.db.dropOldestMessages, {
      threadId,
      keep: QUEUE_CAP_WARNING_THRESHOLD,
    });
    
    // Notify user that messages were dropped
    await ctx.scheduler.runAfter(0, internal.api.telegram.sendChatMessage, {
      chatId: telegramChatId,
      message: "⚠️ Queue limit reached (100 messages). Oldest messages were dropped.",
    });
    
    console.log(`[queueMessage] Queue cap reached for thread ${threadId}, dropped ${result.dropped} messages`);
  }

  await ctx.runMutation(internal.users.db.appendPendingMessage, {
    threadId,
    text,
  });

  // Reset backoff on fresh user input — user is actively engaging
  await ctx.runMutation(internal.users.db.resetConsecutiveFailures, {
    telegramChatId,
  });

  // Always schedule queue processing - self-draining model
  await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
    threadId,
    telegramChatId,
  });
}

export const processMessageQueue = internalAction({
  args: {
    threadId: v.string(),
    telegramChatId: v.string(),
  },
  handler: async (
    ctx: any,
    { threadId, telegramChatId }: { threadId: string; telegramChatId: string },
  ) => {
    // Try to acquire lock - exit if another worker is processing (or lock is fresh)
    const acquired = await ctx.runMutation(
      internal.users.db.acquireQueueLock,
      { telegramChatId },
    );
    if (!acquired) {
      console.log(`[processMessageQueue] Lock already held for ${telegramChatId}, exiting`);
      return;
    }

    try {
      await processWithLock(ctx, threadId, telegramChatId);
    } finally {
      // Always release lock on exit
      await ctx.runMutation(internal.users.db.releaseQueueLock, { telegramChatId });
    }
  },
});

async function processWithLock(
  ctx: any,
  threadId: string,
  telegramChatId: string,
): Promise<void> {
  // Atomic pop: get and clear messages in one operation
  const pendingText = await ctx.runMutation(
    internal.users.db.popPendingMessages,
    { threadId },
  );
  
  // No messages to process
  if (!pendingText || pendingText.trim() === "") {
    return;
  }

  // Start initial typing indicator (heartbeat removed - not needed)
  try {
    await sendTelegramChatAction(telegramChatId, "typing");
  } catch (err) {
    console.log("[processMessageQueue] Typing indicator failed (non-critical):", err);
  }

  try {
    const messages = pendingText
      .split("\n")
      .filter((m: string) => m.trim() !== "");

    // Guard against empty messages after filtering
    if (messages.length === 0) {
      // Messages already cleared by popPendingMessages, just check for more
      await checkAndContinueDraining(ctx, threadId, telegramChatId);
      return;
    }

    const batchPrompt =
      messages.length === 1
        ? messages[0]
        : `Queued:\n ` +
          messages
            .map((m: string, i: number) => `Message ${i + 1}: ${m}`)
            .join("\n");

    // Guard against empty prompt - can happen with new/empty threads
    if (!batchPrompt || batchPrompt.trim() === "") {
      logger.warn(`[processMessageQueue] Empty prompt after filtering, skipping generation`, { threadId });
      await checkAndContinueDraining(ctx, threadId, telegramChatId);
      return;
    }

    const model = await resolveLanguageModel(ctx, threadId, telegramChatId);

    logger.info(`[processMessageQueue] Starting LLM generation`, {
      threadId,
      "ai.model": typeof model === "string" ? model : (model as any)?.model,
    });

    // Run agent turn on the existing history (no prompt argument)
    // This ensures we pick up the message saved in the mutation turn.
    const result = await julesAgent.generateText(
      ctx,
      { threadId, userId: telegramChatId },
      { model },
    );

    // Send the agent's response directly to Telegram
    if (result.text && result.text.trim()) {
      await ctx.runAction(internal.api.telegram.sendChatMessage, {
        chatId: telegramChatId,
        message: result.text,
      });
    }

    await ctx.runMutation(internal.users.db.resetConsecutiveFailures, {
      telegramChatId,
    });
  } catch (error: any) {
    logger.error("[processMessageQueue] Error:", error);
    const errorMessage = error?.message || String(error);

    // Handle orphaned tool calls — heal the thread history and retry
    if (errorMessage.includes("Tool result is missing for tool call") || errorMessage.includes("AI_MissingToolResultsError")) {
      logger.warn(`[processMessageQueue] Orphaned tool calls detected on thread ${threadId}, healing and retrying`);
      try {
        await ctx.runMutation(internal.users.db.healOrphanedToolCalls, { threadId });
      } catch (healError: any) {
        logger.error("[processMessageQueue] Failed to heal orphaned tool calls:", healError);
      }
      // Re-queue the messages and retry
      await ctx.runMutation(internal.users.db.prependPendingMessage, {
        threadId,
        text: pendingText,
      });
      await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
        threadId,
        telegramChatId,
      });
      return;
    }

    // Re-queue the failed messages so they can be retried
    await ctx.runMutation(internal.users.db.prependPendingMessage, {
      threadId,
      text: pendingText,
    });

    // Handle snapshot race condition transparently
    if (errorMessage.includes("messages must not be empty")) {
      logger.warn(`[processMessageQueue] Snapshot race detected on thread ${threadId}, retrying immediately`);
      await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
        threadId,
        telegramChatId,
      });
      return;
    }

    if (isNonRetriableError(error)) {
      await sendTelegramMessage(
        telegramChatId,
        `❌ *Error:* ${escapeMdv2(errorMessage)}\n\n_Your message is saved\. Once you fix the issue \(e\.g\. via /connect\), send any message to resume\._`,
      );
    } else {
      const failures = await ctx.runMutation(
        internal.users.db.incrementConsecutiveFailures,
        { telegramChatId },
      );
      const delayMs = getBackoffDelayMs(failures);

      let tip =
        "_Use /connect to set your API keys\. Your message is saved and will resume once fixed\._";
      if (errorMessage.includes("Jules API key")) {
        tip = "*Tip:* Your Jules API key is missing or invalid\. Use /connect to set it up\.";
      }

      await sendTelegramMessage(
        telegramChatId,
        `❌ *Error:* ${escapeMdv2(errorMessage)}\n\n${tip}`,
      );

      // Schedule retry with backoff
      await ctx.scheduler.runAfter(delayMs, internal.api.telegram.processMessageQueue, {
        threadId,
        telegramChatId,
      });
    }

    // Don't continue draining on error - let the retry handle it
    return;
  }

  // Self-draining: check if more messages arrived and continue processing
  await checkAndContinueDraining(ctx, threadId, telegramChatId);
}

/**
 * Check if more messages exist and continue draining the queue.
 * This enables self-draining behavior without needing a running flag.
 */
async function checkAndContinueDraining(
  ctx: any,
  threadId: string,
  telegramChatId: string,
): Promise<void> {
  const queueDepth = await ctx.runQuery(internal.users.db.getQueueDepth, {
    threadId,
  });
  
  if (queueDepth > 0) {
    console.log(`[processMessageQueue] More messages pending (${queueDepth}), continuing drain`);
    await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
      threadId,
      telegramChatId,
    });
  }
}

export const sendChatMessage = internalAction({
  args: { 
    chatId: v.string(), 
    message: v.string(),
    parseMode: v.optional(v.union(v.literal("HTML"), v.literal("MarkdownV2"))),
  },
  handler: async (ctx: any, args: { chatId: string; message: string; parseMode?: "HTML" | "MarkdownV2" }) => {
    try {
      // Chunk the message first, then format each chunk for Telegram (MarkdownV2)
      const chunks = chunkMessage(args.message);
      for (const chunk of chunks) {
        const formattedChunk = args.parseMode === "HTML" ? chunk : formatTelegramMessage(chunk);
        await sendTelegramMessage(args.chatId, formattedChunk, args.parseMode ?? "MarkdownV2");
      }
    } catch (error) {
      logger.error("[sendChatMessage] Error sending message:", error);
      throw error;
    }
  },
});

export const sendChatDocument = internalAction({
  args: {
    chatId: v.string(),
    fileContent: v.string(),
    filename: v.string(),
    caption: v.optional(v.string()),
  },
  handler: async (
    ctx: any,
    args: {
      chatId: string;
      fileContent: string;
      filename: string;
      caption?: string;
    },
  ) => {
    try {
      await sendTelegramDocument(
        args.chatId,
        Buffer.from(args.fileContent),
        args.filename,
        args.caption,
      );
    } catch (error) {
      logger.error("[sendChatDocument] Error sending document:", error);
      throw error;
    }
  },
});

export const downloadAndStoreFile = internalAction({
  args: {
    telegramChatId: v.string(),
    fileId: v.string(),
    fileName: v.string(),
    caption: v.optional(v.string()),
    size: v.number(),
  },
  handler: async (
    ctx: any,
    args: {
      telegramChatId: string;
      fileId: string;
      fileName: string;
      caption?: string;
      size: number;
    },
  ) => {
    try {
      const fileBuffer = await downloadTelegramFile(args.fileId);
      const storageId = await ctx.storage.store(
        new Blob([fileBuffer as any], { type: "application/octet-stream" }),
      );

      const threadId = await ctx.runMutation(
        internal.users.db.getOrCreateUserThread,
        {
          telegramChatId: args.telegramChatId,
        },
      );

      await ctx.runMutation((internal as any).files.db.addUploadedFile, {
        threadId,
        storageId,
        originalName: args.fileName,
        caption: args.caption,
        size: args.size,
      });

      // Send success confirmation only after successful storage
      if (args.caption) {
        await sendTelegramMessage(
          args.telegramChatId,
          `Caption for file "${args.fileName}": ${args.caption}`,
        );
      } else {
        await sendTelegramMessage(
          args.telegramChatId,
          `File "${args.fileName}" uploaded`,
        );
      }
    } catch (error) {
      logger.error("[downloadAndStoreFile] ERROR:", error);
      try {
        await sendTelegramMessage(
          args.telegramChatId,
          `❌ Error uploading file "${args.fileName}": ${String(error)}`,
        );
      } catch (e) {
        logger.error(
          "[downloadAndStoreFile] Failed to send error message:",
          e,
        );
      }
    }
  },
});

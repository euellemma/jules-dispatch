"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { julesAgent, resolveLanguageModel } from "../agent/instance";
import { chunkHtml } from "./utils";
import { withRetry } from "../utils/retry";
import { INITIAL_CONFIG, isConfigured } from "../config/initial";

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
): Promise<void> {
  await telegramApiCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
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
        "⛔ <b>Bot Already Claimed</b>\n\nThis bot is already connected to another user. Each deployment can only have one owner.",
      );
      return { success: true, handled: true };
    }

    const isConnectCommand =
      text.startsWith("/connect") || text.startsWith("/start");

    try {
      const existingUser = await ctx.runQuery(
        internal.users.db.getProviderConfig,
        { telegramChatId: chatId },
      );

      let justSeeded = false;

      if (!existingUser.config && !existingUser.julesApiKey) {
        if (isConfigured(INITIAL_CONFIG)) {
          await ctx.runMutation(internal.users.db.seedFromInitial, {
            telegramChatId: chatId,
            julesApiKey: INITIAL_CONFIG.julesApiKey,
            exaApiKey: INITIAL_CONFIG.exaApiKey,
            llmEndpoint: INITIAL_CONFIG.llmEndpoint,
            llmModel: INITIAL_CONFIG.llmModel,
            llmApiKey: INITIAL_CONFIG.llmApiKey,
            llmSdkType: INITIAL_CONFIG.llmSdkType,
          });

          justSeeded = true;
        } else if (!isConnectCommand) {
          await sendTelegramMessage(
            chatId,
            "👋 <b>Welcome to Jules Dispatch!</b>\n\nI need an AI provider to function. Please use /connect to set up your API key (OpenCode, Gemini, Anthropic, etc.) before we start chatting.",
          );
          return { success: true, handled: true };
        }
      }

      if (!isConnectCommand && !justSeeded) {
        if (!existingUser.config) {
          await sendTelegramMessage(
            chatId,
            "👋 <b>Welcome to Jules Dispatch!</b>\n\nI need an AI provider to function. Please use /connect to set up your API key (OpenCode, Gemini, Anthropic, etc.) before we start chatting.",
          );
          return { success: true, handled: true };
        }
        if (!existingUser.julesApiKey) {
          await sendTelegramMessage(
            chatId,
            "🔑 <b>Jules API Key Required</b>\n\nI need a Jules API key to manage your coding sessions. Please use /connect to set it up.",
          );
          return { success: true, handled: true };
        }
      }
    } catch (error) {
      console.error("[telegram] Onboarding check failed:", error);
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

      if (caption) {
        const threadId = await ctx.runMutation(
          internal.users.db.getOrCreateUserThread,
          {
            telegramChatId: chatId,
          },
        );
        await queueMessage(ctx, chatId, `Caption for file "${fileName}": ${caption}`, threadId);
      }

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
    console.error("[processTelegramUpdate] ERROR:", error);
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
        "👋 <b>Welcome to Jules Dispatch!</b>\n\nI am your AI agent assistant. I can help you manage code sessions, search the web, and more.\n\nType /connect to set up your AI providers.",
      );
      return true;

    case "/help":
      await sendTelegramMessage(
        chatId,
        "📖 <b>Jules Dispatch Help</b>\n\n" +
          "/connect - Configure your AI provider and API key\n" +
          "/new - Start fresh, keep history (Facts)\n" +
          "/compact - Summarize conversation memory\n" +
          "/reset - NUCLEAR: Wipe all data and history\n" +
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
        `🔗 <b>Connect your AI provider</b>\n\nClick the link below to configure your LLM provider (OpenCode, Google AI Studio, Anthropic, OpenAI, etc.):\n\n<a href="${settingsUrl}">${settingsUrl}</a>\n\n<i>This link expires in 24 hours.</i>`,
      );
      return true;
    }

    case "/new":
      await sendTelegramMessage(
        chatId,
        "🆕 <b>Starting fresh...</b> Wiping todos and files, but keeping our shared history.",
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
      await telegramApiCall("sendMessage", {
        chat_id: chatId,
        text: "⚠️ <b>Reset All Data</b>\n\nThis will permanently delete ALL observational memory, tasks, and file history. Your API keys will be kept.\n\nAre you sure?",
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Yes, reset everything",
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
        "🧹 <b>Compacting conversation memory...</b>\n\nI am summarizing the middle of our conversation to save space while keeping the recent context fresh.",
      );
      await ctx.scheduler.runAfter(0, internal.memory.processor.compactMemory, {
        threadId,
      });
      return true;

    default:
      if (text.startsWith("/")) {
        await sendTelegramMessage(
          chatId,
          "❓ <b>Unknown command.</b>\n\nType /help for a list of available commands.",
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
      text: "☢️ <b>Nuking all data...</b> Please wait.",
      parse_mode: "HTML",
    });

    await ctx.scheduler.runAfter(0, internal.users.actions.nukeUserAction, {
      telegramChatId: chatId,
    });

    await sendTelegramMessage(
      chatId,
      "✅ <b>System Reset Complete.</b> All memories and threads have been deleted. API keys preserved.",
    );
  } else if (data === "nuke_cancel") {
    await telegramApiCall("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "❌ <b>Reset Cancelled.</b> No data was deleted.",
      parse_mode: "HTML",
    });
  }

  await telegramApiCall("answerCallbackQuery", {
    callback_query_id: query.id,
  });
}

async function queueMessage(
  ctx: any,
  telegramChatId: string,
  text: string,
  threadId: string,
): Promise<void> {
  await ctx.runMutation(internal.users.db.appendPendingMessage, {
    threadId,
    text,
  });

  const isRunning = await ctx.runQuery(internal.users.db.isAgentRunning, {
    threadId,
  });

  if (!isRunning) {
    await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
      threadId,
      telegramChatId,
    });
  }
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
    const isRunning = await ctx.runQuery(internal.users.db.isAgentRunning, {
      threadId,
    });
    if (isRunning) {
      console.log("[processMessageQueue] Agent already running, queuing");
      return;
    }

    const pendingText = await ctx.runQuery(
      internal.users.db.getPendingMessages,
      { threadId },
    );
    if (!pendingText || pendingText.trim() === "") {
      return;
    }

    await ctx.runMutation(internal.users.db.setAgentRunning, {
      threadId,
      isRunning: true,
    });

    try {
      await sendTelegramChatAction(telegramChatId, "typing");

      const messages = pendingText
        .split("\n")
        .filter((m: string) => m.trim() !== "");
      const batchPrompt =
        messages.length === 1
          ? messages[0]
          : `Queued:\n ` +
            messages
              .map((m: string, i: number) => `Message ${i + 1}: ${m}`)
              .join("\n");

      const model = await resolveLanguageModel(ctx, threadId);
      await julesAgent.generateText(
        ctx,
        { threadId },
        { model, prompt: batchPrompt },
      );

      await ctx.runMutation(internal.users.db.clearPendingMessages, {
        threadId,
      });
      await sendTelegramChatAction(telegramChatId, "cancel");
    } catch (error: any) {
      console.error("[processMessageQueue] Error:", error);
      await sendTelegramChatAction(telegramChatId, "cancel");
      const errorMessage = error?.message || String(error);

      let tip =
        "<i>You can change your AI provider or model by using /connect. Your message is saved and will resume once you update your settings.</i>";

      if (
        errorMessage.includes("Provider not configured") ||
        errorMessage.includes("API key")
      ) {
        tip =
          "<b>Tip:</b> Your AI provider might be misconfigured. Use /connect to check your settings.";
      } else if (errorMessage.includes("Jules API key")) {
        tip =
          "<b>Tip:</b> Your Jules API key is missing or invalid. Use /connect to set it up.";
      }

      await sendTelegramMessage(
        telegramChatId,
        `❌ <b>Error:</b> ${errorMessage}\n\n${tip}`,
      );
      // NOTE: We do NOT clearPendingMessages here, so it stays for recovery.
    } finally {
      await ctx.runMutation(internal.users.db.setAgentRunning, {
        threadId,
        isRunning: false,
      });

      const newPending = await ctx.runQuery(
        internal.users.db.getPendingMessages,
        { threadId },
      );
      if (newPending && newPending.trim() !== "" && !isRunning) {
        // If we have more and it's not an error state that stopped us
        // (In a real queue we'd check if the error was retriable)
      }
    }
  },
});

export const sendChatMessage = internalAction({
  args: { chatId: v.string(), message: v.string() },
  handler: async (ctx: any, args: { chatId: string; message: string }) => {
    try {
      const chunks = chunkHtml(args.message);
      for (const chunk of chunks) {
        await sendTelegramMessage(args.chatId, chunk);
      }
    } catch (error) {
      console.error("[sendChatMessage] Error sending message:", error);
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
      console.error("[sendChatDocument] Error sending document:", error);
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
        new Blob([new Uint8Array(fileBuffer).buffer]) as any,
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
    } catch (error) {
      console.error("[downloadAndStoreFile] ERROR:", error);
      try {
        await sendTelegramMessage(
          args.telegramChatId,
          `❌ Error uploading file "${args.fileName}": ${String(error)}`,
        );
      } catch (e) {
        console.error(
          "[downloadAndStoreFile] Failed to send error message:",
          e,
        );
      }
    }
  },
});

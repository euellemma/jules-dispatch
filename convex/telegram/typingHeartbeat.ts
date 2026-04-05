"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { INITIAL_CONFIG } from "../config/initial";
import { withRetry } from "../utils/retry";

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
      maxAttempts: 3,
      baseDelayMs: 500,
      isRetriable: (e) => e?.status === 429 || e?.status >= 500,
    },
  );
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

export const heartbeat = internalAction({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    // Check if agent is still running
    const isRunning = await ctx.runQuery(internal.users.db.isAgentRunning, {
      threadId: args.threadId,
    });

    if (!isRunning) {
      return;
    }

    // Get chat ID for the thread
    const chatId = await ctx.runQuery(internal.users.db.getChatIdForThread, {
      threadId: args.threadId,
    });

    if (!chatId) {
      return;
    }

    // Send typing indicator
    try {
      await sendTelegramChatAction(chatId, "typing");
    } catch (error) {
      console.error("[typingHeartbeat] Failed to send typing action:", error);
    }

    // Schedule next heartbeat in 4 seconds (before Telegram's 5s timeout)
    await ctx.scheduler.runAfter(
      4000,
      internal.telegram.typingHeartbeat.heartbeat,
      { threadId: args.threadId },
    );
  },
});

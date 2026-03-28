import { Bot, Context } from "grammy";
import * as fs from "fs";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("[bot] TELEGRAM_BOT_TOKEN not set in .env.local");
  process.exit(1);
}

// ─── Dynamic Convex URL resolution ─────────────────────────────────────────

function getConvexUrl(): string | undefined {
  // 1. Check process.env first
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }

  // 2. Read from .env.local file
  try {
    const envContent = fs.readFileSync(".env.local", "utf-8");
    const match = envContent.match(/^CONVEX_URL=(.+)$/m);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // File doesn't exist or can't be read
  }

  return undefined;
}

// ─── Convex communication ──────────────────────────────────────────────────

async function waitForConvex(
  maxRetries = 60,
  intervalMs = 2000,
): Promise<string | null> {
  console.log("[bot] Waiting for Convex to be ready...");

  for (let i = 0; i < maxRetries; i++) {
    // Get URL dynamically (checks env var first, then file)
    const convexUrl = getConvexUrl();

    if (!convexUrl) {
      // Silently wait for URL to be available
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      continue;
    }

    // Try to connect using the found URL
    try {
      const response = await fetch(`${convexUrl}/api/health`);
      if (response.ok) {
        const data = (await response.json()) as { status: string };
        if (data.status === "ok") {
          console.log(`[bot] Convex is ready at ${convexUrl}`);
          return convexUrl;
        }
      }
    } catch {
      // Convex not ready yet, silently retry
    }

    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  console.error("[bot] Convex did not become ready in time");
  return null;
}

let convexUrl: string | null = null;

async function sendToConvex(payload: Record<string, unknown>): Promise<void> {
  if (!convexUrl) {
    console.error("[bot] Cannot send to Convex: URL not set");
    return;
  }
  
  const response = await fetch(`${convexUrl}/bot/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`[bot] Convex error: ${response.status} ${error}`);
  }
}

// ─── Unsupported media rejection ───────────────────────────────────────────

const UNSUPPORTED_MEDIA_REPLY =
  "That media type is not supported yet. Please send text messages or document files for now.";

function hasUnsupportedMedia(message: Record<string, unknown>): boolean {
  const mediaKeys = [
    "photo",
    "video",
    "audio",
    "voice",
    "video_note",
    "sticker",
    "animation",
    "location",
    "contact",
  ];
  return mediaKeys.some((key) => message[key] !== undefined);
}

// ─── Bot setup ─────────────────────────────────────────────────────────────

async function main() {
  console.log("[bot] Starting Jules Dispatch Telegram bot...");

  const convexUrlResult = await waitForConvex();
  if (!convexUrlResult) {
    console.error("[bot] Cannot start: Convex not available");
    process.exit(1);
  }
  
  convexUrl = convexUrlResult;
  console.log(`[bot] Connected to Convex at ${convexUrl}`);

  const bot = new Bot(TELEGRAM_BOT_TOKEN as string);

  // Handle text and document messages
  bot.on("message", async (ctx: Context) => {
    const message = ctx.message;
    if (!message) return;

    const chatId = String(message.chat.id);

    // Reject unsupported media types (photos, video, audio, etc.)
    if (hasUnsupportedMedia(message as unknown as Record<string, unknown>)) {
      console.log(`[bot] Unsupported media from ${chatId}`);
      await ctx.reply(UNSUPPORTED_MEDIA_REPLY);
      return;
    }

    // Text message
    if ("text" in message && message.text) {
      console.log(
        `[bot] Message from ${chatId}: ${message.text.substring(0, 50)}...`,
      );
      await sendToConvex({
        chatId,
        text: message.text,
      });
      return;
    }

    // Document message
    if ("document" in message && message.document) {
      const doc = message.document;
      const caption = "caption" in message ? message.caption : undefined;
      console.log(`[bot] Document from ${chatId}: ${doc.file_name}`);
      await sendToConvex({
        chatId,
        document: {
          fileId: doc.file_id,
          fileName: doc.file_name || "unknown_file",
          fileSize: doc.file_size || 0,
          caption,
        },
      });
      return;
    }
  });

  // Handle callback queries (inline button presses, e.g. /reset confirmation)
  bot.on("callback_query", async (ctx: Context) => {
    const query = ctx.callbackQuery;
    if (!query || !query.data) return;

    const chatId = String(query.message?.chat.id ?? query.from.id);
    console.log(`[bot] Callback from ${chatId}: ${query.data}`);

    await sendToConvex({
      chatId,
      callbackQuery: {
        queryId: query.id,
        data: query.data,
        chatId,
        messageId: query.message?.message_id ?? 0,
      },
    });
  });

  bot.on("edited_message", async () => {
    console.log("[bot] Edited messages not supported");
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("[bot] Shutting down...");
    bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[bot] Polling Telegram...");
  await bot.start();
}

main().catch((err) => {
  console.error("[bot] Fatal error:", err);
  process.exit(1);
});

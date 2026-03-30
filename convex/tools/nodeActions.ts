"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import JSZip from "jszip";
import { jules as julesSdk } from "@google/jules-sdk";
import { INITIAL_CONFIG } from "../config/initial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJulesApiKey(ctx: any, threadId?: string): Promise<string> {
  if (threadId) {
    const user = await ctx.runQuery(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (internal as any).users.db.getChatIdForThread,
      { threadId }
    ) as string | null;

    if (user) {
      const res = await ctx.runQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (internal as any).users.db.getProviderConfig,
        { telegramChatId: user }
      ) as { julesApiKey?: string };

      if (res?.julesApiKey) return res.julesApiKey;
    }
  }

  // Fall back to initial config (for testing mode cron jobs)
  if (INITIAL_CONFIG.julesApiKey) {
    return INITIAL_CONFIG.julesApiKey;
  }

  throw new Error(
    "Jules API key not configured. Re-run the setup wizard or use /connect."
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getJulesClient(ctx: any, threadId?: string) {
  const apiKey = await getJulesApiKey(ctx, threadId);
  return julesSdk.with({ apiKey });
}

export const sendTelegramDocumentAction = internalAction({
  args: {
    telegramChatId: v.string(),
    fileContent: v.string(),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runAction(internal.api.telegram.sendChatDocument, {
        chatId: args.telegramChatId,
        fileContent: args.fileContent,
        filename: args.filename,
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const sendTelegramZipAction = internalAction({
  args: {
    telegramChatId: v.string(),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
    filename: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      const zip = new JSZip();
      for (const file of args.files) {
        zip.file(file.path, file.content);
      }
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      await ctx.runAction(internal.api.telegram.sendChatDocument, {
        chatId: args.telegramChatId,
        fileContent: zipBuffer.toString("base64"),
        filename: args.filename,
      });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});

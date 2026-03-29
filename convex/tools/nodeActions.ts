"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import JSZip from "jszip";
import { jules as julesSdk } from "@google/jules-sdk";

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
async function getJulesApiKey(ctx: { runQuery: Function }, threadId?: string): Promise<string | null> {
  // 1. Try to get user-specific API key from database
  if (threadId) {
    const telegramChatId = await ctx.runQuery(internal.users.db.getChatIdForThread, { threadId });
    if (telegramChatId) {
      const res = await ctx.runQuery(internal.users.db.getProviderConfig, { telegramChatId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userKey = (res as any).julesApiKey;
      if (userKey) return userKey;
    }
  }

  // 2. Fall back to environment variable (for bootstrap/anonymous mode)
  const envKey = process.env.JULES_API_KEY;
  if (envKey) return envKey;

  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export async function getJulesClient(ctx: { runQuery: Function }, threadId?: string) {
  const apiKey = await getJulesApiKey(ctx, threadId);
  if (!apiKey) {
    throw new Error(
      "Jules API key not configured. " +
      "Please use /connect in Telegram to set your API key, " +
      "or set the JULES_API_KEY environment variable in your Convex deployment."
    );
  }
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

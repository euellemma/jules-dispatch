"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import JSZip from "jszip";
import { jules as julesSdk } from "@google/jules-sdk";
import { INITIAL_CONFIG } from "../config/initial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJulesApiKey(ctx: any): Promise<string> {
  // Get from singleton bot config (saves 1 DB read vs per-user lookup)
  const config = await ctx.runQuery(
    (internal as any).config.botConfig.getConfig,
    {},
  );
  
  if (config?.julesApiKey) {
    return config.julesApiKey;
  }

  // Fall back to env var (for backward compatibility)
  if (INITIAL_CONFIG.julesApiKey) {
    return INITIAL_CONFIG.julesApiKey;
  }

  throw new Error(
    "Jules API key missing. Configure it in /settings page or set JULES_API_KEY env var."
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getJulesClient(ctx: any) {
  const apiKey = await getJulesApiKey(ctx);
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
      console.log(`[sendTelegramDocument] Sending '${args.filename}' to chat ${args.telegramChatId} (${args.fileContent.length} chars)`);
      await ctx.runAction(internal.api.telegram.sendChatDocument, {
        chatId: args.telegramChatId,
        fileContent: args.fileContent,
        filename: args.filename,
      });
      console.log(`[sendTelegramDocument] Sent '${args.filename}' successfully`);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sendTelegramDocument] Failed to send '${args.filename}':`, msg);
      return { success: false, error: msg };
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
      console.log(`[sendTelegramZip] Creating ZIP '${args.filename}' with ${args.files.length} file(s) for chat ${args.telegramChatId}`);
      const zip = new JSZip();
      for (const file of args.files) {
        zip.file(file.path, file.content);
      }
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      console.log(`[sendTelegramZip] ZIP generated (${zipBuffer.length} bytes), sending...`);

      await ctx.runAction(internal.api.telegram.sendChatDocument, {
        chatId: args.telegramChatId,
        fileContent: zipBuffer.toString("base64"),
        filename: args.filename,
      });
      console.log(`[sendTelegramZip] ZIP '${args.filename}' sent successfully`);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sendTelegramZip] Failed to send '${args.filename}':`, msg);
      return { success: false, error: msg };
    }
  },
});

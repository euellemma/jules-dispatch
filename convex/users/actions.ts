import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal, components } from "../_generated/api";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

export const testConnection = internalAction({
  args: {
    endpoint: v.string(),
    model: v.string(),
    apiKey: v.string(),
    sdkType: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openai-compatible"),
    ),
  },
  handler: async (ctx, { endpoint, model, apiKey, sdkType }) => {
    try {
      let modelInstance;

      if (sdkType === "anthropic") {
        const anthropic = createAnthropic({ baseURL: endpoint, apiKey });
        modelInstance = anthropic(model);
      } else if (sdkType === "google") {
        const google = createGoogleGenerativeAI({ baseURL: endpoint, apiKey });
        modelInstance = google(model);
      } else if (sdkType === "openai") {
        const openai = createOpenAI({ baseURL: endpoint, apiKey });
        modelInstance = openai(model);
      } else {
        const provider = createOpenAICompatible({ name: "test", baseURL: endpoint, apiKey });
        modelInstance = provider(model);
      }

      await generateText({
        model: modelInstance,
        prompt: "hi",
      });

      return { success: true };
    } catch (error: any) {
      console.error("[testConnection] Connection failed:", error);
      return { success: false, error: error.message || String(error) };
    }
  },
});

export const nukeUserAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    // 1. Get the old thread ID and delete DB entries
    const oldThreadId = (await ctx.runMutation(internal.users.db.nukeUserData, {
      telegramChatId: args.telegramChatId,
    })) as string | null;

    if (!oldThreadId) return;

    // 2. Delete ALL files from storage (single-user setup)
    const storageIds = (await ctx.runMutation(internal.files.db.deleteAllFiles, {})) as any[];

    for (const sid of storageIds) {
      await ctx.storage.delete(sid);
    }
  },
});

export const cycleThreadAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args): Promise<string | undefined> => {
    // Memory is per-user (keyed by telegramChatId), so no handover summary needed.
    // Cycle thread — memory entries persist automatically.
    const ids = (await ctx.runMutation(internal.users.db.cycleUserThread, {
      telegramChatId: args.telegramChatId,
    })) as { newThreadId: string; oldThreadId: string } | null;

    if (!ids) return;

    // Cleanup old thread files
    const storageIds = (await ctx.runMutation(internal.files.db.deleteFilesForThread, {
      threadId: ids.oldThreadId,
    })) as any[];
    for (const sid of storageIds) {
      await ctx.storage.delete(sid);
    }

    // Delete old thread
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: ids.oldThreadId,
    });

    return ids.newThreadId;
  },
});

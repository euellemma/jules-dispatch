import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal, components } from "../_generated/api";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { resolveLanguageModel } from "../agent/instance";

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

    // 3. Clear the actual thread messages in the agent component
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: oldThreadId,
    });
  },
});

export const cycleThreadAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args): Promise<string | undefined> => {
    // 1. Pre-Handover Summary
    const user = (await ctx.runMutation(internal.users.db.getOrCreateUserThread, { 
      telegramChatId: args.telegramChatId 
    })) as string;
    const oldThreadId = user; // Mutation returns threadId

    let handoverNote = "";
    try {
      const model = await resolveLanguageModel(ctx, oldThreadId);
      const result = await generateText({
        model,
        prompt: "Summarize the current task, recent successes, and what should be done next in one concise bullet point. Focus on technical progress. If there's nothing active, just say 'No active tasks'.",
      });
      handoverNote = result.text.trim();
    } catch (e) {
      console.error("Handover summary failed:", e);
      handoverNote = "Session cycled. No specific handover available.";
    }

    // 2. Cycle thread and move memory
    const ids = (await ctx.runMutation(internal.users.db.cycleUserThread, {
      telegramChatId: args.telegramChatId,
      preserveMemory: true,
    })) as { newThreadId: string; oldThreadId: string } | null;

    if (!ids) return;

    // 3. Add Handover Note to memory
    const handoverText = `\n- [Handover Note from last session]: ${handoverNote}. (Note: Do not assume any tasks are currently active. Confirm with the user your next hypothesis before acting).`;
    
    const memory = (await ctx.runQuery(internal.memory.db.getMemory, { threadId: ids.newThreadId })) as any;
    await ctx.runMutation(internal.memory.db.upsertMemory, {
      threadId: ids.newThreadId,
      activeObservations: (memory?.activeObservations || "") + handoverText,
      lastObservedAt: Date.now(),
      observationTokenCount: (memory?.observationTokenCount || 0) + 100, // estimate
    });

    // 4. Cleanup old storage
    const storageIds = (await ctx.runMutation(internal.files.db.deleteFilesForThread, {
      threadId: ids.oldThreadId,
    })) as any[];
    for (const sid of storageIds) {
      await ctx.storage.delete(sid);
    }

    // 5. Delete old thread
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: ids.oldThreadId,
    });

    return ids.newThreadId;
  },
});

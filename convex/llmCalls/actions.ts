import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const insertLlmCall = internalMutation({
  args: {
    threadId: v.string(),
    userId: v.string(),
    model: v.string(),
    provider: v.string(),
    requestBody: v.any(),
    responseBody: v.any(),
    finishReason: v.optional(v.string()),
    usage: v.optional(
      v.object({
        promptTokens: v.number(),
        completionTokens: v.number(),
        totalTokens: v.number(),
      }),
    ),
    durationMs: v.number(),
    status: v.union(v.literal("success"), v.literal("error")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("llmCalls", { ...args, timestamp: Date.now() });
  },
});
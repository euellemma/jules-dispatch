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
    let reqBody = args.requestBody;
    let resBody = args.responseBody;
    
    // Truncate to ~400KB to stay well under 1MB Convex document limit
    const MAX_LEN = 400_000;
    if (typeof reqBody === 'string' && reqBody.length > MAX_LEN) {
      reqBody = reqBody.slice(0, MAX_LEN) + '... [TRUNCATED]';
    }
    if (typeof resBody === 'string' && resBody.length > MAX_LEN) {
      resBody = resBody.slice(0, MAX_LEN) + '... [TRUNCATED]';
    }

    await ctx.db.insert("llmCalls", { 
      ...args, 
      requestBody: reqBody,
      responseBody: resBody,
      timestamp: Date.now() 
    });
  },
});
import { query } from "../_generated/server";
import { v } from "convex/values";

export const listLlmCalls = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("llmCalls")
      .order("desc")
      .take(limit);
  },
});
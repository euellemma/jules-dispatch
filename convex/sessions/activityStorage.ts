import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const storeActivity = internalMutation({
  args: {
    julesSessionId: v.string(),
    type: v.string(),
    createTime: v.number(),
    summary: v.string(),
    filesChanged: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessionActivities", args);
  },
});

export const getActivitiesForSession = internalQuery({
  args: { julesSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionActivities")
      .withIndex("by_session", (q) => q.eq("julesSessionId", args.julesSessionId))
      .order("asc")
      .collect();
  },
});

import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

export const getBotsByOwner = query({
  args: { ownerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("provisionedBots")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .collect();
  },
});

export const getBotsByStatus = query({
  args: { statuses: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results = [];
    for (const status of args.statuses) {
      const bots = await ctx.db
        .query("provisionedBots")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
      results.push(...bots);
    }
    return results;
  },
});

export const getBotByRepo = query({
  args: { githubRepo: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("provisionedBots")
      .withIndex("by_githubRepo", (q) => q.eq("githubRepo", args.githubRepo))
      .first();
  },
});

export const createBot = mutation({
  args: {
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    githubRepo: v.string(),
    convexSiteUrl: v.optional(v.string()),
    status: v.string(),
    sourceType: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("provisionedBots", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateBot = mutation({
  args: {
    id: v.id("provisionedBots"),
    patches: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      ...args.patches,
      updatedAt: Date.now(),
    });
  },
});

export const deleteBot = mutation({
  args: { id: v.id("provisionedBots") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

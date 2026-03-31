import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const getMemory = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const memory = await ctx.db
      .query("observationalMemory")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    return memory;
  },
});

export const upsertMemory = internalMutation({
  args: {
    threadId: v.string(),
    activeObservations: v.string(),
    lastObservedAt: v.number(),
    observationTokenCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("observationalMemory")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        activeObservations: args.activeObservations,
        lastObservedAt: args.lastObservedAt,
        observationTokenCount: args.observationTokenCount,
      });
    } else {
      await ctx.db.insert("observationalMemory", {
        threadId: args.threadId,
        activeObservations: args.activeObservations,
        lastObservedAt: args.lastObservedAt,
        observationTokenCount: args.observationTokenCount,
      });
    }
  },
});

export const updateLastObservedAt = internalMutation({
  args: {
    threadId: v.string(),
    lastObservedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const memory = await ctx.db
      .query("observationalMemory")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (memory) {
      await ctx.db.patch(memory._id, { lastObservedAt: args.lastObservedAt });
    }
  },
});

export const initializeMemory = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("observationalMemory")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    
    if (existing) return;
    
    await ctx.db.insert("observationalMemory", {
      threadId: args.threadId,
      activeObservations: "",
      lastObservedAt: 0,
      observationTokenCount: 0,
    });
  },
});

export const clearMemory = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const memory = await ctx.db
      .query("observationalMemory")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (memory) {
      await ctx.db.patch(memory._id, {
        activeObservations: "",
        lastObservedAt: 0,
        observationTokenCount: 0,
      });
    }
  },
});
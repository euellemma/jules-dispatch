import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const listTasksForThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const upsertTasks = internalMutation({
  args: {
    threadId: v.string(),
    key: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("byThreadAndKey", (q) =>
        q.eq("threadId", args.threadId).eq("key", args.key)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content });
    } else {
      await ctx.db.insert("tasks", {
        threadId: args.threadId,
        key: args.key,
        content: args.content,
      });
    }
  },
});

export const deleteTasks = internalMutation({
  args: {
    threadId: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("byThreadAndKey", (q) =>
        q.eq("threadId", args.threadId).eq("key", args.key)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const deleteTasksForThread = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const task of tasks) {
      await ctx.db.delete(task._id);
    }
  },
});

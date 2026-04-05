import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const addUploadedFile = internalMutation({
  args: {
    threadId: v.string(),
    storageId: v.id("_storage"),
    originalName: v.string(),
    caption: v.optional(v.string()),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("uploadedFiles", {
      threadId: args.threadId,
      storageId: args.storageId,
      originalName: args.originalName,
      caption: args.caption,
      size: args.size,
      status: "unregistered",
    });
    return null;
  },
});

export const getThreadFiles = internalQuery({
  args: { threadId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const deleteFilesForThread = internalMutation({
  args: { threadId: v.string() },
  returns: v.array(v.id("_storage")),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();

    const storageIds: Id<"_storage">[] = [];
    for (const f of files) {
      storageIds.push(f.storageId);
      await ctx.db.delete(f._id);
    }
    return storageIds;
  }
});

export const deleteAllFiles = internalMutation({
  args: {},
  returns: v.array(v.id("_storage")),
  handler: async (ctx) => {
    const files = await ctx.db.query("uploadedFiles").collect();

    const storageIds: Id<"_storage">[] = [];
    for (const f of files) {
      storageIds.push(f.storageId);
      await ctx.db.delete(f._id);
    }
    return storageIds;
  }
});

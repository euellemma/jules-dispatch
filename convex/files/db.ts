import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const addUploadedFile = internalMutation({
  args: {
    threadId: v.string(),
    storageId: v.id("_storage"),
    originalName: v.string(),
    caption: v.optional(v.string()),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("uploadedFiles", {
      threadId: args.threadId,
      storageId: args.storageId,
      originalName: args.originalName,
      caption: args.caption,
      size: args.size,
      status: "unregistered",
    });
  },
});

export const getThreadFiles = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

export const registerFiles = internalMutation({
  args: {
    threadId: v.string(),
    registrations: v.array(
      v.object({
        fileId: v.id("uploadedFiles"),
        assignedName: v.string(),
        action: v.union(v.literal("register"), v.literal("delete")),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results = [];
    for (const reg of args.registrations) {
      const file = await ctx.db.get(reg.fileId);
      if (!file || file.threadId !== args.threadId) {
        results.push({ id: reg.fileId, success: false, error: "Not found or unauthorized" });
        continue;
      }

      if (reg.action === "delete") {
        await ctx.db.delete(reg.fileId);
        results.push({ id: reg.fileId, success: true, action: "deleted" });
      } else {
        await ctx.db.patch(reg.fileId, {
          assignedName: reg.assignedName,
          status: "registered",
        });
        results.push({ id: reg.fileId, success: true, action: "registered", name: reg.assignedName });
      }
    }
    return results;
  },
});

export const getFileTextContent = internalQuery({
  args: { fileId: v.id("uploadedFiles") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    if (!file) throw new Error("File not found");
    const blobUrl = await ctx.storage.getUrl(file.storageId);
    if (!blobUrl) throw new Error("Could not generate URL for storage ID");
    
    // We fetch this on the action side so we return the URL and name
    return { url: blobUrl, name: file.assignedName || file.originalName };
  }
});

export const getFileByAssignedName = internalQuery({
  args: { 
    threadId: v.string(),
    assignedName: v.string() 
  },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .filter((q) => q.eq(q.field("assignedName"), args.assignedName))
      .collect();
    
    // Return the first match (agent is responsible for unique naming)
    const file = files[0];
    if (!file) return null;
    
    const blobUrl = await ctx.storage.getUrl(file.storageId);
    if (!blobUrl) throw new Error("Could not generate URL for storage ID");
    
    return { 
      id: file._id,
      url: blobUrl, 
      name: file.assignedName || file.originalName 
    };
  }
});

export const deleteFilesForThread = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    
    const storageIds = [];
    for (const f of files) {
      storageIds.push(f.storageId);
      await ctx.db.delete(f._id);
    }
    return storageIds;
  }
});

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const checkDuplicateWaiting = internalQuery({
  args: { sessionLabel: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_sessionLabel_status", (q) => q.eq("sessionLabel", args.sessionLabel).eq("status", "waiting"))
      .first();
    return existing ? { interactionId: existing.interactionId, createdAt: existing.createdAt } : null;
  },
});

export const createInteraction = internalMutation({
  args: {
    interactionId: v.string(),
    threadId: v.string(),
    sessionLabel: v.string(),
    filePath: v.string(),
    fileContent: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("terminalInteractions", {
      interactionId: args.interactionId,
      threadId: args.threadId,
      sessionLabel: args.sessionLabel,
      filePath: args.filePath,
      fileContent: args.fileContent,
      status: "waiting",
      context: args.context,
      createdAt: Date.now(),
    });
    return id;
  },
});

export const getInteractionById = internalQuery({
  args: { interactionId: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_interactionId", (q) => q.eq("interactionId", args.interactionId))
      .first();
    return results ?? null;
  },
});

export const getLatestWaitingBySessionLabel = internalQuery({
  args: { sessionLabel: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_sessionLabel_status", (q) => q.eq("sessionLabel", args.sessionLabel).eq("status", "waiting"))
      .order("desc")
      .first();
    return results ?? null;
  },
});

export const writeResponse = internalMutation({
  args: {
    interactionId: v.string(),
    response: v.string(),
  },
  handler: async (ctx, args) => {
    const interaction = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_interactionId", (q) => q.eq("interactionId", args.interactionId))
      .first();

    if (!interaction) {
      throw new Error(`Interaction not found: ${args.interactionId}`);
    }

    await ctx.db.patch(interaction._id, {
      status: "responded",
      response: args.response,
      respondedAt: Date.now(),
    });

    return { success: true };
  },
});

export const markConsumed = internalMutation({
  args: {
    interactionId: v.string(),
  },
  handler: async (ctx, args) => {
    const interaction = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_interactionId", (q) => q.eq("interactionId", args.interactionId))
      .first();

    if (!interaction) {
      return { success: false, error: "Interaction not found" };
    }

    await ctx.db.patch(interaction._id, {
      status: "consumed",
      consumedAt: Date.now(),
    });

    return { success: true };
  },
});

export const getInteractionBySessionLabelForPolling = internalQuery({
  args: { sessionLabel: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_sessionLabel_status", (q) => q.eq("sessionLabel", args.sessionLabel).eq("status", "responded"))
      .order("desc")
      .first();
    return results ?? null;
  },
});

export const getLatestInteractionBySessionLabel = internalQuery({
  args: { sessionLabel: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("terminalInteractions")
      .withIndex("by_sessionLabel", (q) => q.eq("sessionLabel", args.sessionLabel))
      .order("desc")
      .first();
    return results ?? null;
  },
});
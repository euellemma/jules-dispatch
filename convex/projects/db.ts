import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const DEFAULT_CONFIG = {
  base_branch: "main",
  auto_merge: true,
  merge_method: "squash",
  require_plan_approval: false,
  max_parallel_sessions: 5,
  ci_timeout_minutes: 10,
  conflict_retries: 2,
  session_economy: "balanced",
};

export const initProject = internalMutation({
  args: {
    threadId: v.string(),
    repo: v.string(),
    config: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .filter((q) => q.eq(q.field("threadId"), args.threadId))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("projects", {
      threadId: args.threadId,
      repo: args.repo,
      config: args.config ?? DEFAULT_CONFIG,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateProject = internalMutation({
  args: {
    projectId: v.id("projects"),
    repo: v.optional(v.string()),
    threadId: v.optional(v.string()),
    config: v.optional(v.any()),
    plan: v.optional(v.string()),
    progress: v.optional(v.string()),
    tasks: v.optional(v.any()),
    sessionBudget: v.optional(
      v.object({
        plan: v.string(),
        dailyLimit: v.number(),
        usedToday: v.number(),
        lastReset: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { projectId, ...updates } = args;
    await ctx.db.patch(projectId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const appendProjectMemory = internalMutation({
  args: {
    projectId: v.id("projects"),
    entry: v.object({
      date: v.string(),
      iteration: v.number(),
      type: v.string(),
      input: v.string(),
      sessions: v.number(),
      prsMerged: v.string(),
      filesChanged: v.string(),
      learning: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const memoryEntries = project.memoryEntries ?? [];
    memoryEntries.push(args.entry);

    await ctx.db.patch(args.projectId, {
      memoryEntries,
      updatedAt: Date.now(),
    });
  },
});

export const updateSessionBudget = internalMutation({
  args: {
    projectId: v.id("projects"),
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const todayDateStr = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    let sessionBudget = project.sessionBudget;

    if (!sessionBudget) {
      sessionBudget = {
        plan: "default",
        dailyLimit: 20, // default limit
        usedToday: 0,
        lastReset: todayDateStr,
      };
    }

    if (sessionBudget.lastReset !== todayDateStr) {
      sessionBudget.usedToday = 0;
      sessionBudget.lastReset = todayDateStr;
    }

    sessionBudget.usedToday += args.delta;

    await ctx.db.patch(args.projectId, {
      sessionBudget,
      updatedAt: Date.now(),
    });
  },
});

export const getProjectByRepo = internalQuery({
  args: {
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .first();
  },
});

export const getProjectByThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});

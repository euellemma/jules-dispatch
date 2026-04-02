import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const addSession = internalMutation({
  args: {
    threadId: v.string(),
    julesSessionId: v.string(),
    shortName: v.string(),
    repo: v.optional(v.string()),
    prefs: v.optional(v.object({
      approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
      verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
    })),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("julesSessions", {
      threadId: args.threadId,
      julesSessionId: args.julesSessionId,
      shortName: args.shortName,
      lastProcessedActivityTime: Date.now(),
      origin: "agent",
      acknowledged: true,
      inDashboard: true,
      prefs: args.prefs ?? { approval: "confirm", verbosity: "milestones" },
      repo: args.repo,
    });
  }
});

export const updateSessionState = internalMutation({
  args: { 
    sessionId: v.id("julesSessions"), 
    lastKnownState: v.string(),
    lastProcessedActivityTime: v.number()
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { 
      lastKnownState: args.lastKnownState,
      lastProcessedActivityTime: args.lastProcessedActivityTime
    });
  }
});

export const getAllSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("julesSessions").collect();
  },
});

export const getDashboardSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("julesSessions")
      .withIndex("by_inDashboard", (q) => q.eq("inDashboard", true))
      .collect();
  }
});

export const getUnacknowledgedSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("julesSessions")
      .withIndex("by_acknowledged", (q) => q.eq("acknowledged", false))
      .collect();
  }
});

export const upsertDiscoveredSession = internalMutation({
  args: {
    julesSessionId: v.string(),
    lastKnownState: v.optional(v.string()),
    title: v.optional(v.string()),
    repo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("julesSessions")
      .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
      .unique();
    
    if (existing) {
      const updates: Record<string, any> = {};
      if (args.lastKnownState !== undefined) updates.lastKnownState = args.lastKnownState;
      if (args.repo !== undefined && args.repo !== "repoless") updates.repo = args.repo;
      if (args.title !== undefined && existing.shortName === undefined) {
        updates.shortName = args.title;
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(existing._id, updates);
      }
      return existing._id;
    }

    const id = await ctx.db.insert("julesSessions", {
      threadId: "",
      julesSessionId: args.julesSessionId,
      shortName: args.title,
      lastProcessedActivityTime: 0,
      lastKnownState: args.lastKnownState,
      origin: "discovered",
      acknowledged: false,
      inDashboard: false,
      prefs: { approval: "confirm", verbosity: "milestones" },
      repo: args.repo,
    });
    return id;
  }
});

export const saveSessionOutputs = internalMutation({
  args: {
    julesSessionId: v.string(),
    outputs: v.array(v.object({
      type: v.string(),
      source: v.optional(v.string()),
      baseCommitId: v.optional(v.string()),
      extractedFiles: v.optional(v.array(v.object({
        path: v.string(),
        content: v.string(),
      }))),
      patch: v.optional(v.string()),
      url: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      activityId: v.optional(v.string()),
      isIncremental: v.optional(v.boolean()),
    })),
  },
  handler: async (ctx, args) => {
    for (const output of args.outputs) {
      if (output.isIncremental) {
        const existing = await ctx.db
          .query("sessionOutputs")
          .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
          .filter((q) => q.eq(q.field("isIncremental"), true))
          .unique();

        if (existing) {
          await ctx.db.patch(existing._id, {
            type: output.type,
            source: output.source,
            baseCommitId: output.baseCommitId,
            extractedFiles: output.extractedFiles,
            patch: output.patch,
            url: output.url,
            title: output.title,
            description: output.description,
            baseRef: output.baseRef,
            headRef: output.headRef,
            activityId: output.activityId,
          });
          continue;
        }
      }

      await ctx.db.insert("sessionOutputs", {
        julesSessionId: args.julesSessionId,
        type: output.type,
        source: output.source,
        baseCommitId: output.baseCommitId,
        extractedFiles: output.extractedFiles,
        patch: output.patch,
        url: output.url,
        title: output.title,
        description: output.description,
        baseRef: output.baseRef,
        headRef: output.headRef,
        activityId: output.activityId,
        isIncremental: output.isIncremental,
      });
    }
  }
});

export const getSessionOutputs = internalQuery({
  args: { julesSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionOutputs")
      .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
      .collect();
  }
});

export const getSessionByJulesId = internalQuery({
  args: { julesSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("julesSessions")
      .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
      .unique();
  }
});

export const getBulkSessionOutputs = internalQuery({
  args: { julesSessionIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const allOutputs = await ctx.db.query("sessionOutputs").collect();
    const map = new Map<string, typeof allOutputs>();
    for (const o of allOutputs) {
      if (args.julesSessionIds.includes(o.julesSessionId)) {
        const arr = map.get(o.julesSessionId) || [];
        arr.push(o);
        map.set(o.julesSessionId, arr);
      }
    }
    return map;
  },
});

export const bulkUpdateSessions = internalMutation({
  args: {
    julesSessionIds: v.array(v.string()),
    updates: v.object({
      acknowledged: v.optional(v.boolean()),
      inDashboard: v.optional(v.boolean()),
      prefs: v.optional(v.object({
        approval: v.optional(v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict"))),
        verbosity: v.optional(v.union(v.literal("silent"), v.literal("milestones"), v.literal("full"))),
      })),
      repo: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const allSessions = await ctx.db.query("julesSessions").collect();
    const matching = allSessions.filter(s => args.julesSessionIds.includes(s.julesSessionId));
    
    let updated = 0;
    for (const session of matching) {
      try {
        const patch: Record<string, any> = {};
        if (args.updates.acknowledged !== undefined) patch.acknowledged = args.updates.acknowledged;
        if (args.updates.inDashboard !== undefined) patch.inDashboard = args.updates.inDashboard;
        if (args.updates.repo !== undefined) patch.repo = args.updates.repo;
        if (args.updates.prefs !== undefined) {
          patch.prefs = {
            approval: args.updates.prefs.approval ?? session.prefs?.approval ?? "confirm",
            verbosity: args.updates.prefs.verbosity ?? session.prefs?.verbosity ?? "milestones",
          };
        }

        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(session._id, patch);
          updated++;
        }
      } catch (error) {
        console.error(`Failed to patch session ${session.julesSessionId}:`, error);
      }
    }
    return { updated };
  },
});
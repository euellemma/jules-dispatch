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

export const saveSessionOutputRecord = internalMutation({
  args: {
    julesSessionId: v.string(),
    output: v.object({
      type: v.string(),
      source: v.optional(v.string()),
      baseCommitId: v.optional(v.string()),
      extractedFiles: v.optional(v.array(v.object({
        path: v.string(),
        storageId: v.optional(v.id("_storage")),
      }))),
      patchStorageId: v.optional(v.id("_storage")),
      url: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      activityId: v.optional(v.string()),
      isIncremental: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const { output } = args;

    if (output.isIncremental) {
      const existing = await ctx.db
        .query("sessionOutputs")
        .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
        .filter((q) => q.eq(q.field("isIncremental"), true))
        .unique();

      if (existing) {
        const oldStorageIds: string[] = [];
        if (existing.patchStorageId) oldStorageIds.push(existing.patchStorageId);
        for (const f of existing.extractedFiles || []) {
          if (f.storageId) oldStorageIds.push(f.storageId);
        }

        await ctx.db.patch(existing._id, {
          type: output.type,
          source: output.source,
          baseCommitId: output.baseCommitId,
          extractedFiles: output.extractedFiles,
          patchStorageId: output.patchStorageId,
          url: output.url,
          title: output.title,
          description: output.description,
          baseRef: output.baseRef,
          headRef: output.headRef,
          activityId: output.activityId,
        });

        for (const id of oldStorageIds) {
          await ctx.storage.delete(id as any);
        }
        return;
      }
    } else {
      const existingFinals = await ctx.db
        .query("sessionOutputs")
        .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
        .filter((q) => q.eq(q.field("isIncremental"), false))
        .collect();

      const oldStorageIds: string[] = [];
      for (const rec of existingFinals) {
        if (rec.patchStorageId) oldStorageIds.push(rec.patchStorageId);
        for (const f of rec.extractedFiles || []) {
          if (f.storageId) oldStorageIds.push(f.storageId);
        }
      }

      for (const rec of existingFinals) {
        await ctx.db.delete(rec._id);
      }

      for (const id of oldStorageIds) {
        await ctx.storage.delete(id as any);
      }
    }

    await ctx.db.insert("sessionOutputs", {
      julesSessionId: args.julesSessionId,
      ...output,
    });
  },
});

export const getSessionOutputs = internalQuery({
  args: { julesSessionId: v.string() },
  handler: async (ctx, args) => {
    const outputs = await ctx.db
      .query("sessionOutputs")
      .withIndex("by_julesSessionId", (q) => q.eq("julesSessionId", args.julesSessionId))
      .collect();

    return Promise.all(
      outputs.map(async (o) => {
        let patchContent: string | null = null;
        if (o.patchStorageId) {
          const url = await ctx.storage.getUrl(o.patchStorageId);
          if (url) {
            const response = await fetch(url);
            patchContent = await response.text();
          }
        }

        const extractedFilesWithContent = o.extractedFiles
          ? await Promise.all(
              o.extractedFiles.map(async (f) => {
                let content: string | null = null;
                if (f.storageId) {
                  const url = await ctx.storage.getUrl(f.storageId);
                  if (url) {
                    const response = await fetch(url);
                    content = await response.text();
                  }
                }
                return { path: f.path, content };
              })
            )
          : null;

        return {
          ...o,
          patch: patchContent,
          extractedFiles: extractedFilesWithContent,
        };
      })
    );
  },
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
    const result: Record<string, typeof allOutputs> = {};
    for (const o of allOutputs) {
      if (args.julesSessionIds.includes(o.julesSessionId)) {
        result[o.julesSessionId] ??= [];
        result[o.julesSessionId]!.push(o);
      }
    }
    return result;
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
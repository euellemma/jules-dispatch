"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { getJulesClient } from "../tools/nodeActions";
import { internal } from "../_generated/api";
import type { JulesSessionDoc, JulesApiSession, SessionInfo, SessionQueryResult, SessionOutputDoc } from "../types";
import type { GenericActionCtx } from "convex/server";

type ActionCtx = GenericActionCtx<any>;

async function fetchAllJulesSessions(ctx: ActionCtx, threadId?: string): Promise<JulesApiSession[]> {
  try {
    const jules = await getJulesClient(ctx, threadId);
    const sessions = await jules.sessions({}).all();
    return sessions as JulesApiSession[];
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return [];
  }
}

async function fetchSessionActivities(ctx: ActionCtx, threadId: string | undefined, sessionId: string): Promise<string> {
  try {
    const jules = await getJulesClient(ctx, threadId);
    const session = await jules.session(sessionId);
    const { activities } = await session.activities.list({});
    return formatActivityLog(activities);
  } catch {
    return "";
  }
}

function formatActivityLog(activities: Array<{ type?: string; createTime?: string; originator?: string; title?: string; description?: string; message?: string; reason?: string }>): string {
  return activities.map((act) => {
    const time = new Date(act.createTime || Date.now()).toLocaleTimeString([], {
      hour12: false, hour: '2-digit', minute: '2-digit',
    });
    const originator = act.originator ? `[${act.originator}]` : '';

    if (act.type === 'progressUpdated') {
      let entry = `[${time}] ${originator} Progress: ${act.title}`;
      if (act.description) entry += ` - ${act.description}`;
      return entry;
    } else if (act.type === 'agentMessaged') {
      return `[${time}] ${originator} Agent: ${act.message}`;
    } else if (act.type === 'planGenerated') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan = (act as any).plan;
      return `[${time}] ${originator} Plan: ${plan?.title || 'Untitled'}`;
    } else if (act.type === 'planApproved') {
      return `[${time}] ${originator} Plan Approved`;
    } else if (act.type === 'sessionCompleted') {
      return `[${time}] ${originator} Session Completed`;
    } else if (act.type === 'sessionFailed') {
      return `[${time}] ${originator} Session Failed: ${act.reason}`;
    } else if (act.type === 'userMessaged') {
      return `[${time}] ${originator} User: ${act.message}`;
    } else {
      return `[${time}] ${originator} ${act.type}: ${act.description || ''}`;
    }
  }).join('\n');
}

function extractRepo(js: JulesApiSession): string {
  try {
    if (js.source?.github && typeof js.source.github === "string") {
      return js.source.github;
    }
    if (js.source?.githubRepo) {
      return `${js.source.githubRepo.owner}/${js.source.githubRepo.repo}`;
    }
  } catch {
    // ignore
  }
  return "repoless";
}

/**
 * getAllSessionsBasic — fetch all Jules sessions merged with DB metadata (no PR metadata).
 * Used by manage_sessions which doesn't need fuzzy search data.
 */
export const getAllSessionsBasic = internalAction({
  args: {
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SessionQueryResult> => {
    let julesSessions: JulesApiSession[];
    let dbSessions: JulesSessionDoc[];

    try {
      [julesSessions, dbSessions] = await Promise.all([
        fetchAllJulesSessions(ctx, args.threadId),
        ctx.runQuery(internal.sessions.db.getAllSessions, {}),
      ]);
    } catch (error) {
      console.error("Error in getAllSessionsBasic:", error);
      try {
        dbSessions = await ctx.runQuery(internal.sessions.db.getAllSessions, {});
        const dbOnly: SessionInfo[] = dbSessions.map((db: JulesSessionDoc) => ({
          julesSessionId: db.julesSessionId,
          title: db.shortName,
          state: db.lastKnownState,
          repo: db.repo || "repoless",
          shortName: db.shortName,
          origin: db.origin,
          acknowledged: db.acknowledged,
          inDashboard: db.inDashboard,
          prefs: db.prefs,
        }));
        return { success: true, sessions: dbOnly };
      } catch {
        return { success: false, error: "Failed to fetch sessions from DB" };
      }
    }

    const dbMap = new Map(dbSessions.map((s: JulesSessionDoc) => [s.julesSessionId, s]));

    const sessions: SessionInfo[] = julesSessions.map((js: JulesApiSession) => {
      const db = dbMap.get(js.id);
      return {
        julesSessionId: js.id,
        title: js.title || db?.shortName,
        state: js.state || db?.lastKnownState,
        repo: db?.repo || extractRepo(js),
        shortName: db?.shortName,
        origin: (db?.origin as "agent" | "discovered") || "discovered",
        acknowledged: db?.acknowledged ?? false,
        inDashboard: db?.inDashboard ?? false,
        prefs: db?.prefs,
        lastActivity: js.createTime ? new Date(js.createTime).toLocaleString() : undefined,
        createTimeMs: js.createTime ? new Date(js.createTime).getTime() : undefined,
      };
    });

    const toUpsert = julesSessions.filter((js: JulesApiSession) => !dbMap.has(js.id));
    if (toUpsert.length > 0) {
      await Promise.all(
        toUpsert.map((js: JulesApiSession) =>
          ctx.runMutation(internal.sessions.db.upsertDiscoveredSession, {
            julesSessionId: js.id,
            lastKnownState: js.state,
            title: js.title,
            repo: extractRepo(js),
          })
        )
      );
    }

    return { success: true, sessions };
  },
});

/**
 * getAllSessionsWithInfo — fetch all Jules sessions merged with DB metadata + PR metadata.
 * Used by query_sessions which needs full metadata for fuzzy search.
 */
export const getAllSessionsWithInfo = internalAction({
  args: {
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SessionQueryResult> => {
    let julesSessions: JulesApiSession[];
    let dbSessions: JulesSessionDoc[];

    try {
      [julesSessions, dbSessions] = await Promise.all([
        fetchAllJulesSessions(ctx, args.threadId),
        ctx.runQuery(internal.sessions.db.getAllSessions, {}),
      ]);
    } catch (error) {
      console.error("Error in getAllSessionsWithInfo:", error);
      try {
        dbSessions = await ctx.runQuery(internal.sessions.db.getAllSessions, {});
        const dbOnly: SessionInfo[] = dbSessions.map((db: JulesSessionDoc) => ({
          julesSessionId: db.julesSessionId,
          title: db.shortName,
          state: db.lastKnownState,
          repo: db.repo || "repoless",
          shortName: db.shortName,
          origin: db.origin,
          acknowledged: db.acknowledged,
          inDashboard: db.inDashboard,
          prefs: db.prefs,
        }));
        return { success: true, sessions: dbOnly };
      } catch {
        return { success: false, error: "Failed to fetch sessions from DB" };
      }
    }

    const dbMap = new Map(dbSessions.map((s: JulesSessionDoc) => [s.julesSessionId, s]));

    // Batch PR metadata query (eliminate N+1)
    let outputsMap = new Map<string, SessionOutputDoc[]>();
    try {
      const sessionIds = julesSessions.map((js: JulesApiSession) => js.id);
      if (sessionIds.length > 0) {
        outputsMap = await ctx.runQuery(internal.sessions.db.getBulkSessionOutputs, {
          julesSessionIds: sessionIds,
        });
      }
    } catch (error) {
      console.warn("Bulk PR metadata query failed, proceeding without PR metadata:", error);
    }

    const sessionsWithMetadata: SessionInfo[] = julesSessions.map((js: JulesApiSession) => {
      const db = dbMap.get(js.id);
      const outputs = outputsMap.get(js.id) || [];
      const prMetadata = outputs
        .filter((o: SessionOutputDoc) => o.type === "pullRequest")
        .map((o: SessionOutputDoc) => ({
          title: o.title,
          description: o.description,
        }));

      return {
        julesSessionId: js.id,
        title: js.title || db?.shortName,
        state: js.state || db?.lastKnownState,
        repo: db?.repo || extractRepo(js),
        shortName: db?.shortName,
        origin: (db?.origin as "agent" | "discovered") || "discovered",
        acknowledged: db?.acknowledged ?? false,
        inDashboard: db?.inDashboard ?? false,
        prefs: db?.prefs,
        lastActivity: js.createTime ? new Date(js.createTime).toLocaleString() : undefined,
        createTimeMs: js.createTime ? new Date(js.createTime).getTime() : undefined,
        prMetadata,
      };
    });

    const toUpsert = julesSessions.filter((js: JulesApiSession) => !dbMap.has(js.id));
    if (toUpsert.length > 0) {
      await Promise.all(
        toUpsert.map((js: JulesApiSession) =>
          ctx.runMutation(internal.sessions.db.upsertDiscoveredSession, {
            julesSessionId: js.id,
            lastKnownState: js.state,
            title: js.title,
            repo: extractRepo(js),
          })
        )
      );
    }

    return { success: true, sessions: sessionsWithMetadata };
  },
});

/**
 * getSessionDetails — fetch details + activity log for specific session IDs.
 * Used by the session manager sub-agent to inspect individual sessions.
 */
export const getSessionDetails = internalAction({
  args: {
    sessionIds: v.array(v.string()),
    threadId: v.optional(v.string()),
    sessions: v.optional(v.array(v.object({
      julesSessionId: v.string(),
      title: v.optional(v.string()),
      state: v.optional(v.string()),
      repo: v.optional(v.string()),
      shortName: v.optional(v.string()),
      origin: v.union(v.literal("agent"), v.literal("discovered")),
      acknowledged: v.boolean(),
      inDashboard: v.boolean(),
      prefs: v.optional(v.object({
        approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
        verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
      })),
    }))),
  },
  handler: async (ctx, args): Promise<SessionQueryResult> => {
    const preFetchedMap = new Map<string, {
      julesSessionId: string;
      title?: string;
      state?: string;
      repo?: string;
      shortName?: string;
      origin: "agent" | "discovered";
      acknowledged: boolean;
      inDashboard: boolean;
      prefs?: {
        approval: "auto" | "confirm" | "strict";
        verbosity: "silent" | "milestones" | "full";
      };
    }>();
    if (args.sessions && args.sessions.length > 0) {
      for (const s of args.sessions) {
        preFetchedMap.set(s.julesSessionId, s);
      }
    }

    let julesSessions: JulesApiSession[] = [];
    let dbMap = new Map<string, JulesSessionDoc>();

    if (!args.sessions || args.sessions.length === 0) {
      try {
        [julesSessions, dbMap] = await Promise.all([
          fetchAllJulesSessions(ctx, args.threadId).then(sessions => {
            const filtered = sessions.filter((js: JulesApiSession) =>
              args.sessionIds.includes(js.id)
            );
            return filtered;
          }),
          ctx.runQuery(internal.sessions.db.getAllSessions, {}).then(dbSessions =>
            new Map(dbSessions.map((s: JulesSessionDoc) => [s.julesSessionId, s]))
          ),
        ]);
      } catch (error) {
        console.error("Error in getSessionDetails:", error);
        return { success: false, error: "Failed to fetch session details" };
      }
    }

    const results: SessionInfo[] = [];
    for (const id of args.sessionIds) {
      const preFetched = preFetchedMap.get(id);
      const js = julesSessions.find((s: JulesApiSession) => s.id === id);
      const db = dbMap.get(id);

      if (!preFetched && !js && !db) {
        results.push({
          julesSessionId: id,
          title: undefined,
          state: "not_found",
          repo: "repoless",
          origin: "discovered",
          acknowledged: false,
          inDashboard: false,
          lastActivity: "(session not found)",
        });
        continue;
      }

      const activities = await fetchSessionActivities(ctx, args.threadId, id);

      results.push({
        julesSessionId: id,
        title: preFetched?.title || js?.title || db?.shortName,
        state: preFetched?.state || js?.state || db?.lastKnownState,
        repo: preFetched?.repo || db?.repo || (js ? extractRepo(js) : "repoless"),
        shortName: preFetched?.shortName || db?.shortName,
        origin: (preFetched?.origin || db?.origin || "discovered") as "agent" | "discovered",
        acknowledged: preFetched?.acknowledged ?? db?.acknowledged ?? false,
        inDashboard: preFetched?.inDashboard ?? db?.inDashboard ?? false,
        prefs: preFetched?.prefs || db?.prefs,
        lastActivity: activities,
      });
    }

    return { success: true, sessions: results };
  },
});

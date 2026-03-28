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

/**
 * getAllSessionsWithInfo — fetch all Jules sessions merged with DB metadata.
 * Used to populate the session manager sub-agent's context.
 */
export const getAllSessionsWithInfo = internalAction({
  args: {
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SessionQueryResult> => {
    const [julesSessions, dbSessions] = await Promise.all([
      fetchAllJulesSessions(ctx, args.threadId),
      ctx.runQuery(internal.sessions.db.getAllSessions, {}),
    ]);

    const dbMap = new Map(dbSessions.map((s: JulesSessionDoc) => [s.julesSessionId, s]));

    // Auto-discover new sessions
    for (const js of julesSessions) {
      if (!dbMap.has(js.id)) {
        await ctx.runMutation(internal.sessions.db.upsertDiscoveredSession, {
          julesSessionId: js.id,
          lastKnownState: js.state,
        });
        dbMap.set(js.id, {
          _id: "" as unknown as import("../_generated/dataModel").Id<"julesSessions">,
          _creationTime: Date.now(),
          julesSessionId: js.id,
          threadId: "",
          shortName: js.title,
          lastProcessedActivityTime: 0,
          lastKnownState: js.state,
          isActive: js.state !== "completed" && js.state !== "failed",
          origin: "discovered",
          acknowledged: false,
          inDashboard: false,
          prefs: { approval: "confirm", verbosity: "milestones" },
        });
      }
    }

    // Parallel fetch PR metadata for fuzzy matching
    const sessionsWithMetadata: SessionInfo[] = await Promise.all(julesSessions.map(async (js: JulesApiSession) => {
      const db = dbMap.get(js.id);
      const outputs = await ctx.runQuery(internal.sessions.db.getSessionOutputs, { julesSessionId: js.id });
      const prMetadata = outputs.filter((o: SessionOutputDoc) => o.type === "pullRequest").map((o: SessionOutputDoc) => ({
        title: o.title,
        description: o.description,
      }));

      const sessionInfo: SessionInfo = {
        julesSessionId: js.id,
        title: js.title || db?.shortName,
        state: js.state || db?.lastKnownState,
        repo: js.source?.github,
        shortName: db?.shortName,
        origin: (db?.origin as "agent" | "discovered") || "discovered",
        acknowledged: db?.acknowledged ?? false,
        inDashboard: db?.inDashboard ?? false,
        prefs: db?.prefs,
        lastActivity: js.createTime ? new Date(js.createTime).toLocaleString() : undefined,
        prMetadata,
      };
      return sessionInfo;
    }));

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
  },
  handler: async (ctx, args): Promise<SessionQueryResult> => {
    const [julesSessions, dbSessions] = await Promise.all([
      fetchAllJulesSessions(ctx, args.threadId),
      ctx.runQuery(internal.sessions.db.getAllSessions, {}),
    ]);

    const dbMap = new Map(dbSessions.map((s: JulesSessionDoc) => [s.julesSessionId, s]));

    const results: SessionInfo[] = [];
    for (const id of args.sessionIds) {
      const js = julesSessions.find((s: JulesApiSession) => s.id === id);
      const db = dbMap.get(id);
      const activities = await fetchSessionActivities(ctx, args.threadId, id);
      results.push({
        julesSessionId: id,
        title: js?.title || db?.shortName,
        state: js?.state || db?.lastKnownState,
        repo: js?.source?.github,
        shortName: db?.shortName,
        origin: db?.origin || "discovered",
        acknowledged: db?.acknowledged || false,
        inDashboard: db?.inDashboard || false,
        prefs: db?.prefs,
        lastActivity: activities,
      });
    }

    return { success: true, sessions: results };
  },
});

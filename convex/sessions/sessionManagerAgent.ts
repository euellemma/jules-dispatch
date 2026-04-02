import { createTool, Agent } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { z } from "zod";
import { manage_sessions } from "../tools/index";
import type { SessionInfo } from "../types";
import { normalizeState, isActiveState } from "../types";

function formatSessionsForContext(sessions: SessionInfo[]): string {
  const tracked = sessions.filter((s) => s.inDashboard);
  const activeUntracked = sessions.filter((s) => {
    const st = normalizeState(s.state);
    return s.acknowledged && !s.inDashboard && isActiveState(st);
  });
  const unregistered = sessions.filter((s) => !s.acknowledged);
  const archived = sessions.filter((s) => {
    const st = normalizeState(s.state);
    return s.acknowledged && !s.inDashboard && !isActiveState(st);
  });

  const lines: string[] = [];

  lines.push("## Tracked Sessions (Dashboard)");
  if (tracked.length > 0) {
    tracked.forEach((s) => {
      const prefs = s.prefs
        ? `${s.prefs.approval}/${s.prefs.verbosity}`
        : "default";
      lines.push(
        `ID: ${s.julesSessionId} | ${s.title || s.shortName || "untitled"} | ${s.state || "unknown"} | ${prefs}`,
      );
      if (s.repo) lines.push(`  Repo: ${s.repo}`);
    });
  } else {
    lines.push("(no tracked sessions)");
  }

  lines.push("\n## Active Untracked Sessions (registered, not in dashboard)");
  if (activeUntracked.length > 0) {
    activeUntracked.forEach((s) => {
      lines.push(
        `ID: ${s.julesSessionId} | ${s.title || s.shortName || "untitled"} | ${s.state || "unknown"}`,
      );
      if (s.repo) lines.push(`  Repo: ${s.repo}`);
    });
  } else {
    lines.push("(no active untracked sessions)");
  }

  lines.push(`\n## Summary of Others`);
  lines.push(
    `- Unregistered: ${unregistered.length} sessions from Jules API (not yet registered).`,
  );
  lines.push(`- Archived: ${archived.length} completed/failed sessions.`);
  lines.push(
    "\nUse 'list_sessions' to discover or search for sessions not listed here.",
  );

  return lines.join("\n");
}

function resolveSinceHours(since: string): number | null {
  switch (since) {
    case "1h":
      return 1;
    case "6h":
      return 6;
    case "24h":
      return 24;
    case "7d":
      return 24 * 7;
    case "30d":
      return 24 * 30;
    case "all":
      return null;
    default:
      return null;
  }
}

const sessionManagerInstructions = `You are the Session Manager for Jules Dispatch.

A summary of tracked and active sessions is injected in your context. Use it to answer questions, find sessions, and manage them.
Make sure to report your usage of tools (not verbose output but success/failure of each tool calls you make)

## Jules Session States

Sessions can be in one of these states:
- QUEUED: Waiting to be processed
- PLANNING: Creating a plan
- AWAITING_PLAN_APPROVAL: Plan ready, needs user approval
- AWAITING_USER_FEEDBACK: Needs user input
- IN_PROGRESS: Actively working
- PAUSED: Session paused (can be resumed)
- FAILED: Session failed
- COMPLETED: Successfully completed

Sessions are RESUMABLE - sending a message to a COMPLETED/FAILED session will resume it.

## Your Tools

**list_sessions** — Discover and search ALL sessions from the Jules API. Supports filters:
- since: "1h" | "6h" | "24h" | "7d" | "30d" | "all" — time window (default "24h")
- state: one or more states from: QUEUED, PLANNING, AWAITING_PLAN_APPROVAL, AWAITING_USER_FEEDBACK, IN_PROGRESS, PAUSED, FAILED, COMPLETED, all
- topic: fuzzy search on titles, repos, PR metadata
Use this when the user asks to "find", "list", or "show" sessions.

**inspect_session** — Fetch full details + activity log for a session. Call this when the user asks for deep details or logs.

**manage_sessions** — Bulk manage sessions:
- REGISTER: Acknowledge unregistered sessions (marks them as known)
- TRACK: Add sessions to the dashboard for active monitoring
- ARCHIVE: Remove tracked sessions from the dashboard (untrack). Only works on tracked sessions.
- CONFIGURE: Update approval/verbosity preferences

## Guidelines
- Report tool calls (success/failure).
- Return stats by state unless the prompt explicitly asks for details or search.
- Use list_sessions when the prompt asks to find/list/search sessions.
- Use inspect_session when the prompt asks for details/logs of a specific session.
- Use REGISTER to handle unregistered sessions.
- Use TRACK to move sessions to the user's dashboard.
- Use ARCHIVE to untrack sessions from the dashboard.

## Selection Targets
When calling manage_sessions, you can use 'target':
- 'unregistered': All sessions not yet acknowledged.
- 'tracked': All sessions currently in the dashboard.
- 'active': All non-terminal sessions (QUEUED, PLANNING, IN_PROGRESS, etc.)
- 'needs_attention': Sessions awaiting plan approval, user feedback, or paused.
- 'terminal': All sessions that are COMPLETED or FAILED.
- 'all': Everything.`;

export async function spawnSessionManagerAgent(
  ctx: any,
  sessions: SessionInfo[],
  userPrompt: string,
  originalThreadId: string,
  languageModel: any,
): Promise<string> {
  const local_list_sessions = createTool({
    description:
      "Browse or search ALL Jules sessions. Filters by time (since) and state(s). Use 'topic' for fuzzy search on titles, repos, and PR metadata.",
    inputSchema: z.object({
      since: z
        .enum(["1h", "6h", "24h", "7d", "30d", "all"])
        .default("24h")
        .describe(
          "Only return sessions created within this time window. Default '24h'.",
        ),
      state: z
        .array(
          z.enum([
            "STATE_UNSPECIFIED",
            "QUEUED",
            "PLANNING",
            "AWAITING_PLAN_APPROVAL",
            "AWAITING_USER_FEEDBACK",
            "IN_PROGRESS",
            "PAUSED",
            "FAILED",
            "COMPLETED",
            "all",
          ]),
        )
        .optional()
        .describe(
          "Filter by one or more session states. Omit for no state filter.",
        ),
      topic: z
        .string()
        .optional()
        .describe("Fuzzy search term for titles, repo names, and PR metadata."),
    }),
    execute: async (subCtx, args) => {
      if (!sessions || sessions.length === 0) {
        return "No sessions available. Try refreshing.";
      }

      let filtered = [...sessions];

      // 1. Apply Time Filter (since)
      const sinceHours = resolveSinceHours(args.since);
      if (sinceHours !== null) {
        const cutoff = Date.now() - sinceHours * 60 * 60 * 1000;
        filtered = filtered.filter((s: SessionInfo) => {
          const created =
            s.createTimeMs ||
            (s.lastActivity ? new Date(s.lastActivity).getTime() : 0);
          return created >= cutoff;
        });
      }

      // 2. Apply State Filter
      if (args.state && !args.state.includes("all")) {
        const states = args.state.map((s) => s.toUpperCase());
        filtered = filtered.filter((s: SessionInfo) => {
          const normalized = normalizeState(s.state);
          return states.includes(normalized);
        });
      }

      // 3. Apply Fuzzy Topic Search
      if (args.topic) {
        const term = args.topic.toLowerCase();
        filtered = filtered.filter((s: SessionInfo) => {
          const titleMatch = (s.title || "").toLowerCase().includes(term);
          const shortNameMatch = (s.shortName || "")
            .toLowerCase()
            .includes(term);
          const repoMatch = (s.repo || "").toLowerCase().includes(term);
          const prMatch = (s.prMetadata || []).some(
            (pr: any) =>
              (pr.title || "").toLowerCase().includes(term) ||
              (pr.description || "").toLowerCase().includes(term),
          );
          return titleMatch || shortNameMatch || repoMatch || prMatch;
        });
      }

      if (filtered.length === 0)
        return "No sessions found matching your criteria.";

      const table = filtered
        .map((s: SessionInfo) => {
          return `| ${s.julesSessionId} | ${s.title || s.shortName || "untitled"} | ${s.repo || "none"} | ${s.state || "unknown"} |`;
        })
        .join("\n");

      const stateDesc = args.state ? args.state.join(",") : "all";
      return `### Session List (${args.since}, states=${stateDesc}${args.topic ? ", topic: " + args.topic : ""})\nFound ${filtered.length} session(s)\n| ID | Title | Repo | State |\n|---|---|---|---|\n${table}\n\nTip: Use 'inspect_session(id)' to see full activity logs for a specific session.`;
    },
  });

  const local_inspect_session = createTool({
    description: "Fetch full details and activity log for a specific session.",
    inputSchema: z.object({
      julesSessionId: z.string().describe("The Jules session ID to inspect."),
    }),
    execute: async (subCtx, args) => {
      const matchingSession = sessions.find(
        (s) => s.julesSessionId === args.julesSessionId,
      );
      const sessionsArg = matchingSession ? [matchingSession] : sessions;

      const result = (await subCtx.runAction(
        internal.sessions.sessionManager.getSessionDetails,
        {
          sessionIds: [args.julesSessionId],
          threadId: originalThreadId,
          sessions: sessionsArg,
        },
      )) as any;

      if (!result.success) {
        return `Error: ${result.error || "Failed to fetch session"}`;
      }

      const session = result.sessions?.[0];
      if (!session) return `Session ${args.julesSessionId} not found.`;

      const header = `Session: ${session.title || session.julesSessionId}`;
      const meta = `State: ${session.state || "unknown"} | Repo: ${session.repo || "none"} | Prefs: ${session.prefs?.approval || "confirm"}/${session.prefs?.verbosity || "milestones"}`;
      const activities = session.lastActivity || "(no activities)";

      return `${header}\n${meta}\n\n# Activity Log\n${activities}`;
    },
  });

  const thread = await new Agent(components.agent, {
    name: "Session Manager",
    languageModel: languageModel,
  }).createThread(ctx, {
    title: `Session Manager`,
  });

  const agentThreadId = (thread as any).threadId;

  const sessionsContext =
    sessions.length > 0
      ? formatSessionsForContext(sessions)
      : "(no sessions found)";

  const instructions = sessionManagerInstructions.replace(
    "{SESSIONS_PLACEHOLDER}",
    sessionsContext,
  );

  const sessionManagerAgent = new Agent(components.agent, {
    name: "Session Manager",
    languageModel: languageModel,
    instructions,
    tools: {
      list_sessions: local_list_sessions,
      inspect_session: local_inspect_session,
      manage_sessions,
    },
    maxSteps: 15,
  });

  try {
    const result = await sessionManagerAgent.generateText(
      ctx,
      { threadId: agentThreadId },
      {
        prompt: userPrompt,
      },
    );
    return result.text;
  } catch (error: any) {
    return `Error: ${error.message || String(error)}`;
  } finally {
    try {
      await sessionManagerAgent.deleteThreadAsync(ctx, {
        threadId: agentThreadId,
      });
    } catch {
      // Silently ignore cleanup errors
    }
  }
}

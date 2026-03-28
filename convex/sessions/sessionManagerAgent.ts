import { createTool, Agent } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { manage_sessions } from "../tools/index";

const anthropic = createAnthropic({
  baseURL: "https://opencode.ai/zen/go/v1/",
  apiKey: process.env.OPENCODE_GO_API_KEY,
});

function formatSessionsForContext(sessions: any[]): string {
  const tracked = sessions.filter(s => s.inDashboard);
  const activeUntracked = sessions.filter(s => !s.inDashboard && (s.state !== "completed" && s.state !== "failed"));
  const discovered = sessions.filter(s => !s.acknowledged);
  const archived = sessions.filter(s => s.acknowledged && !s.inDashboard && (s.state === "completed" || s.state === "failed"));

  const lines: string[] = [];
  
  lines.push("## Tracked Sessions (Dashboard)");
  if (tracked.length > 0) {
    tracked.forEach(s => {
      const prefs = s.prefs ? `${s.prefs.approval}/${s.prefs.verbosity}` : "default";
      lines.push(`ID: ${s.julesSessionId} | ${s.title || s.shortName || 'untitled'} | ${s.state || 'unknown'} | ${prefs}`);
      if (s.repo) lines.push(`  Repo: ${s.repo}`);
    });
  } else {
    lines.push("(no tracked sessions)");
  }

  lines.push("\n## Active Untracked Sessions");
  if (activeUntracked.length > 0) {
    activeUntracked.forEach(s => {
      lines.push(`ID: ${s.julesSessionId} | ${s.title || s.shortName || 'untitled'} | ${s.state || 'unknown'}`);
      if (s.repo) lines.push(`  Repo: ${s.repo}`);
    });
  } else {
    lines.push("(no active untracked sessions)");
  }

  lines.push(`\n## Summary of Others`);
  lines.push(`- Discovered: ${discovered.length} sessions (needs registration).`);
  lines.push(`- Archived: ${archived.length} completed sessions.`);
  lines.push("\nUse 'list_sessions' to discover or search for sessions not listed here.");

  return lines.join("\n");
}

/**
 * list_sessions — Internal tool for the session manager sub-agent.
 */
export const list_sessions = createTool({
  description: "Browse or search all Jules sessions (including discovered and archived).",
  inputSchema: z.object({
    filter: z.enum(["tracked", "active", "discovered", "archived", "all"])
      .describe("Which group to list."),
    topic: z.string().optional().describe("Fuzzy search term for titles, repo names, and PR metadata."),
  }),
  execute: async (ctx, args): Promise<string> => {
    const result = await ctx.runAction(
      internal.sessions.sessionManager.getAllSessionsWithInfo,
      {},
    ) as any;

    if (!result.success) return "Error fetching sessions.";

    let filtered = result.sessions as any[];

    // 1. Apply State Filter
    if (args.filter !== "all") {
      filtered = filtered.filter(s => {
        switch (args.filter) {
          case "tracked": return s.inDashboard;
          case "active": return s.state !== "completed" && s.state !== "failed";
          case "discovered": return !s.acknowledged;
          case "archived": return s.acknowledged && !s.inDashboard && (s.state === "completed" || s.state === "failed");
          default: return true;
        }
      });
    }

    // 2. Apply Fuzzy Topic Search
    if (args.topic) {
      const term = args.topic.toLowerCase();
      filtered = filtered.filter(s => {
        const titleMatch = (s.title || "").toLowerCase().includes(term);
        const shortNameMatch = (s.shortName || "").toLowerCase().includes(term);
        const repoMatch = (s.repo || "").toLowerCase().includes(term);
        const prMatch = (s.prMetadata || []).some((pr: any) => 
          (pr.title || "").toLowerCase().includes(term) || (pr.description || "").toLowerCase().includes(term)
        );
        return titleMatch || shortNameMatch || repoMatch || prMatch;
      });
    }

    if (filtered.length === 0) return "No sessions found matching your criteria.";

    const table = filtered.map(s => {
      return `| ${s.julesSessionId} | ${s.title || s.shortName || 'untitled'} | ${s.repo || 'none'} | ${s.state || 'unknown'} |`;
    }).join("\n");

    return `### Session List (${args.filter}${args.topic ? ': ' + args.topic : ''})\n| ID | Title | Repo | State |\n|---|---|---|---|\n${table}\n\nTip: Use 'inspect_session(id)' to see full activity logs for a specific session.`;
  },
});

/**
 * inspect_session — Internal tool for the session manager sub-agent.
 * Calls getSessionDetails action to fetch full session info + activity log.
 */
export const inspect_session = createTool({
  description: "INTERNAL: Fetch full details and activity log for a specific session.",
  inputSchema: z.object({
    julesSessionId: z.string().describe("The Jules session ID to inspect."),
  }),
  execute: async (ctx, args): Promise<string> => {
    const result = await ctx.runAction(
      internal.sessions.sessionManager.getSessionDetails,
      { sessionIds: [args.julesSessionId] },
    ) as any;

    if (!result.success) {
      return `Error: ${result.error || "Failed to fetch session"}`;
    }

    const session = result.sessions?.[0];
    if (!session) return `Session ${args.julesSessionId} not found.`;

    const header = `Session: ${session.title || session.julesSessionId}`;
    const meta = `State: ${session.state || 'unknown'} | Repo: ${session.repo || 'none'} | Prefs: ${session.prefs?.approval || 'confirm'}/${session.prefs?.verbosity || 'milestones'}`;
    const activities = session.lastActivity || "(no activities)";

    return `${header}\n${meta}\n\n# Activity Log\n${activities}`;
  },
});

const sessionManagerInstructions = `You are the Session Manager for Jules Dispatch.

A summary of tracked and active sessions is injected in your context. Use it to answer questions, find sessions, and manage them.

## Your Tools

**list_sessions** — Browse or search through ALL sessions (including discovered/archived). Use this when the user asks to "find" or "list" something not in your immediate context.

**inspect_session** — Fetch full details + activity log for a session. Call this when the user asks for deep details or logs.

**manage_sessions** — Bulk manage sessions: REGISTER (ack discovered), TRACK (add to dashboard), ARCHIVE (remove from dashboard), or CONFIGURE (set prefs).

## Guidelines
- Answer questions using the injected list or by calling list_sessions.
- Keep responses concise.
- If you find sessions via list_sessions, tell the user you found them before taking action.
- Use REGISTER to handle new discovered sessions.
- Use TRACK to move sessions to the user's dashboard.

## Selection Targets
When calling manage_sessions, you can use 'target':
- 'discovered': All unacknowledged sessions.
- 'active': All currently running sessions.
- 'completed': All sessions that have finished or failed.
- 'all': Everything.`;

export async function spawnSessionManagerAgent(
  ctx: any,
  sessions: any[],
  userPrompt: string,
  originalThreadId: string,
): Promise<string> {
  const model = anthropic("minimax-m2.5");

  // Define tools locally to capture originalThreadId
  const local_list_sessions = createTool({
    description: list_sessions.description,
    inputSchema: list_sessions.inputSchema,
    execute: async (subCtx, args) => {
      const result = await subCtx.runAction(
        internal.sessions.sessionManager.getAllSessionsWithInfo,
        { threadId: originalThreadId },
      ) as any;

      if (!result.success) return "Error fetching sessions.";

      let filtered = result.sessions as any[];

      // 1. Apply State Filter
      if (args.filter !== "all") {
        filtered = filtered.filter((s: any) => {
          switch (args.filter) {
            case "tracked": return s.inDashboard;
            case "active": return s.state !== "completed" && s.state !== "failed";
            case "discovered": return !s.acknowledged;
            case "archived": return s.acknowledged && !s.inDashboard && (s.state === "completed" || s.state === "failed");
            default: return true;
          }
        });
      }

      // 2. Apply Fuzzy Topic Search
      if (args.topic) {
        const term = args.topic.toLowerCase();
        filtered = filtered.filter((s: any) => {
          const titleMatch = (s.title || "").toLowerCase().includes(term);
          const shortNameMatch = (s.shortName || "").toLowerCase().includes(term);
          const repoMatch = (s.repo || "").toLowerCase().includes(term);
          const prMatch = (s.prMetadata || []).some((pr: any) => 
            (pr.title || "").toLowerCase().includes(term) || (pr.description || "").toLowerCase().includes(term)
          );
          return titleMatch || shortNameMatch || repoMatch || prMatch;
        });
      }

      if (filtered.length === 0) return "No sessions found matching your criteria.";

      const table = filtered.map((s: any) => {
        return `| ${s.julesSessionId} | ${s.title || s.shortName || 'untitled'} | ${s.repo || 'none'} | ${s.state || 'unknown'} |`;
      }).join("\n");

      return `### Session List (${args.filter}${args.topic ? ': ' + args.topic : ''})\n| ID | Title | Repo | State |\n|---|---|---|---|\n${table}\n\nTip: Use 'inspect_session(id)' to see full activity logs for a specific session.`;
    },
  });

  const local_inspect_session = createTool({
    description: inspect_session.description,
    inputSchema: inspect_session.inputSchema,
    execute: async (subCtx, args) => {
      const result = await subCtx.runAction(
        internal.sessions.sessionManager.getSessionDetails,
        { sessionIds: [args.julesSessionId], threadId: originalThreadId },
      ) as any;

      if (!result.success) {
        return `Error: ${result.error || "Failed to fetch session"}`;
      }

      const session = result.sessions?.[0];
      if (!session) return `Session ${args.julesSessionId} not found.`;

      const header = `Session: ${session.title || session.julesSessionId}`;
      const meta = `State: ${session.state || 'unknown'} | Repo: ${session.repo || 'none'} | Prefs: ${session.prefs?.approval || 'confirm'}/${session.prefs?.verbosity || 'milestones'}`;
      const activities = session.lastActivity || "(no activities)";

      return `${header}\n${meta}\n\n# Activity Log\n${activities}`;
    },
  });

  const thread = await new Agent(components.agent, {
    name: "Session Manager",
    languageModel: model,
  }).createThread(ctx, {
    title: `Session Manager`,
  });

  const agentThreadId = (thread as any).threadId;

  const sessionsContext = sessions.length > 0
    ? formatSessionsForContext(sessions)
    : "(no sessions found)";

  const instructions = sessionManagerInstructions.replace("{SESSIONS_PLACEHOLDER}", sessionsContext);

  const sessionManagerAgent = new Agent(components.agent, {
    name: "Session Manager",
    languageModel: model,
    instructions,
    tools: {
      list_sessions: local_list_sessions,
      inspect_session: local_inspect_session,
      manage_sessions,
    },
    maxSteps: 15,
  });

  try {
    const result = await sessionManagerAgent.generateText(ctx, { threadId: agentThreadId }, {
      prompt: userPrompt,
    });
    return result.text;
  } catch (error: any) {
    return `Error: ${error.message || String(error)}`;
  }
}

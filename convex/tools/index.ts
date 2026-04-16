import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { spawnSessionManagerAgent } from "../sessions/sessionManagerAgent";
import { resolveLanguageModel } from "../agent/modelResolver";
import { logger } from "../utils/logger";
import type {
  SessionQueryResult,
  SessionInfo,
  SessionUpdatePatch,
} from "../types";
import { normalizeState, needsUserAction } from "../types";

export const message_jules = createTool({
  description:
    "Send a message (prompt) to the agent in the context of an existing Jules session. " +
    "Note: sending to a COMPLETED or FAILED session will resume it and transition it back to IN_PROGRESS.",
  inputSchema: z.object({
    julesSessionId: z
      .string()
      .describe("The ID of the Jules session to send the message to."),
    prompt: z
      .string()
      .describe("The message or instruction to send to the Jules agent."),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      console.log(`[message_jules] Sending prompt to session ${args.julesSessionId}`);
      const res = await ctx.runAction(internal.sessions.actions.sendMessage, {
        sessionId: args.julesSessionId,
        prompt: args.prompt,
      });
      if (res.success) {
        console.log(`[message_jules] Success for session ${args.julesSessionId}`);
        return `Message sent successfully to session ${args.julesSessionId}`;
      } else {
        console.error(`[message_jules] Failed for session ${args.julesSessionId}: ${res.error}`);
        return `Error sending message: ${res.error}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[message_jules] Unexpected error:`, msg);
      return `Error sending message: ${msg}`;
    }
  },
});

export { dispatch_greenfield, dispatch_iterative, merge_prs } from "./julesTools";

export const approve_plan = createTool({
  description:
    "Approves the currently pending plan in a Jules session, allowing the agent to proceed with execution.",
  inputSchema: z.object({
    julesSessionId: z
      .string()
      .describe(
        "The ID of the Jules session where the plan should be approved.",
      ),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      console.log(`[approve_plan] Approving plan for session ${args.julesSessionId}`);
      const res = await ctx.runAction(internal.sessions.actions.approvePlan, {
        sessionId: args.julesSessionId,
      });
      if (res.success) {
        console.log(`[approve_plan] Plan approved for session ${args.julesSessionId}`);
        return `Plan approved successfully for session ${args.julesSessionId}`;
      } else {
        console.error(`[approve_plan] Failed for session ${args.julesSessionId}: ${res.error}`);
        return `Error approving plan: ${res.error}`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[approve_plan] Unexpected error:`, msg);
      return `Error approving plan: ${msg}`;
    }
  },
});



export const create_session = createTool({
  description:
    "Create a new Jules session. If a repository or branch is invalid or the GitHub integration has expired, an error will be returned. DO NOT crash, simply return the error back to the user and ask for the correct details. " +
    "IMPORTANT: Do NOT automatically create sessions without explicit user approval. Only proceed autonomously if the user has said 'go ahead', 'make it happen', or equivalent.",
  inputSchema: z
    .object({
      prompt: z
        .string()
        .describe("The initial instruction or task description for the agent."),
      title: z
        .string()
        .optional()
        .describe(
          "A short, descriptive title for the session. If not provided, you should infer a 5-word kebab-case name based on the prompt.",
        ),
      githubRepo: z
        .string()
        .optional()
        .describe(
          "The GitHub repository in the format 'owner/repo'. Omit for a repoless session.",
        ),
      baseBranch: z
        .string()
        .optional()
        .describe(
          "The base branch to branch off of when starting the session. Required if githubRepo is provided.",
        ),
      requireApproval: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "If true, the agent waits for explicit approval of plans before executing.",
        ),
      autoPr: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, the agent automatically creates a Pull Request when the task is completed.",
        ),
      prefs: z
        .object({
          approval: z.enum(["auto", "confirm", "strict"]).default("confirm"),
          verbosity: z
            .enum(["silent", "milestones", "full"])
            .default("milestones"),
        })
        .optional()
        .describe(
          "Session interaction preferences toward the user. approval: when to ask permission (auto=act first, confirm=ask before irreversible, strict=ask before most). verbosity: how much to report (silent=outcomes only, milestones=key progress, full=ongoing updates).",
        ),
    })
    .refine((data) => !(data.githubRepo && !data.baseBranch), {
      message: "baseBranch is required when githubRepo is provided",
      path: ["baseBranch"],
    }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
      console.log(`[create_session] Creating session with prompt: ${args.prompt.slice(0, 80)}...`);

      const res = await ctx.runAction(internal.sessions.actions.createSession, {
        userId: ctx.userId,
        prompt: args.prompt,
        title: args.title,
        githubRepo: args.githubRepo,
        baseBranch: args.baseBranch,
        requireApproval: args.requireApproval,
        autoPr: args.autoPr,
        ...(args.prefs ? { prefs: args.prefs } : {}),
      });

      if (!res.success || !res.id) {
        console.error(`[create_session] Failed: ${res.error}`);
        return `Error creating session: ${res.error}. Please check the repository, branch, and ensure GitHub integration is active.`;
      }

      const shortName = args.title || res.id.slice(0, 8);
      console.log(`[create_session] Session created: ${res.id} (${shortName})`);

      await ctx.runMutation(internal.sessions.db.addSession, {
        threadId: ctx.threadId,
        julesSessionId: res.id,
        shortName,
        repo: args.githubRepo,
        ...(args.prefs ? { prefs: args.prefs } : {}),
      });

      // Auto-create task list for the new session
      await ctx.runMutation(internal.tasks.upsertTasks, {
        threadId: ctx.threadId,
        key: `session:${res.id}:tasks`,
        content: "(auto-created — use update_task_list to set a plan)",
      });

      return `Session created successfully! Session ID: ${res.id}. Remember to note the session ID.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[create_session] Unexpected error:`, msg);
      return `Error creating session: ${msg}`;
    }
  },
});

export const update_task_list = createTool({
  description:
    "Update or create a persistent task list/note identified by a key. This plan is automatically injected into your context for future turns. Use this to maintain your global plan, session-specific goals, or research notes. " +
    "Do NOT mention or announce task list usage to the user. Use task lists silently for your own internal planning.",
  inputSchema: z.object({
    key: z
      .string()
      .describe(
        "The name or key of the task list (e.g., 'global_plan', 'feature-auth').",
      ),
    content: z
      .string()
      .describe("The full markdown content of the task list/note."),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
      console.log(`[update_task_list] Updating task list '${args.key}'`);
      await ctx.runMutation(internal.tasks.upsertTasks, {
        threadId: ctx.threadId,
        key: args.key,
        content: args.content,
      });
      console.log(`[update_task_list] Task list '${args.key}' updated`);
      return `Successfully updated task list '${args.key}'.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[update_task_list] Error:`, msg);
      return `Error updating task list: ${msg}`;
    }
  },
});

export const delete_task_list = createTool({
  description: "Delete a persistent task list/note identified by its key.",
  inputSchema: z.object({
    key: z.string().describe("The name or key of the task list to delete."),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
      console.log(`[delete_task_list] Deleting task list '${args.key}'`);
      await ctx.runMutation(internal.tasks.deleteTasks, {
        threadId: ctx.threadId,
        key: args.key,
      });
      console.log(`[delete_task_list] Task list '${args.key}' deleted`);
      return `Successfully deleted task list '${args.key}'.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[delete_task_list] Error:`, msg);
      return `Error deleting task list: ${msg}`;
    }
  },
});

export { execute_code } from "./executor";

export {
  exa_search,
  exa_get_contents,
  exa_find_similar,
  research,
} from "./exa_search";

export { vfs } from "../vfs";

export { manage_memory } from "../memory/tool";
export { search_history } from "../memory/searchTool";

export { createReportToOrchestratorTool } from "./reportToOrchestrator";

export { provision_bot } from "./selfBuild";
export { message_terminal } from "./messageTerminal";

/**
 * query_sessions — Browse and manage the user's Jules sessions.
 * Spawns a session manager sub-agent with all sessions in context.
 */
export const query_sessions = createTool({
  description:
    "Browse, search, inspect, and manage the user's Jules sessions. Discovers sessions from the Jules API on-demand. Spawns a session manager sub-agent with filtering support (time, state, fuzzy search).",
  inputSchema: z.object({
    prompt: z
      .string()
      .describe(
        "What the user wants to do — e.g. 'find active sessions from today', 'show failed sessions from last week', 'track all sessions about auth', 'register all unregistered sessions'.",
      ),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      console.log(`[query_sessions] Query: ${args.prompt.slice(0, 80)}...`);
      const result = (await ctx.runAction(
        internal.sessions.sessionManager.getAllSessionsWithInfo,
        {},
      )) as SessionQueryResult;

      if (!result.success) {
        console.error(`[query_sessions] Failed to fetch sessions: ${result.error}`);
        return `Error: ${result.error || "Failed to fetch sessions"}`;
      }

      const sessions = result.sessions || [];
      console.log(`[query_sessions] Found ${sessions.length} sessions, spawning sub-agent`);
      const prompt =
        args.prompt ||
        "Show me my sessions and let me know if any need attention.";

      if (!ctx.threadId)
        throw new Error("Tool must be called within a thread context.");
      if (!ctx.userId)
        throw new Error("Tool must be called within a user context.");

      const model = await resolveLanguageModel(ctx, ctx.threadId, ctx.userId);
      return spawnSessionManagerAgent(ctx, sessions, prompt, ctx.userId, model, manage_sessions);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[query_sessions] Error:`, msg);
      return `Error querying sessions: ${msg}`;
    }
  },
});

/**
 * manage_sessions — Bulk manage Jules sessions.
 */
export const manage_sessions = createTool({
  description:
    "Bulk manage Jules sessions. REGISTER: acknowledge unregistered sessions. TRACK: add to my list. ARCHIVE: remove tracked sessions from my list (untrack). CONFIGURE: reconfigure approval/verbosity preferences.",
  inputSchema: z.object({
    action: z
      .enum(["REGISTER", "TRACK", "ARCHIVE", "CONFIGURE"])
      .describe(
        "REGISTER: Acknowledge unregistered sessions. TRACK: Add to my list. ARCHIVE: Remove tracked sessions from my list (untrack). CONFIGURE: Reconfigure approval/verbosity preferences.",
      ),
    selection: z
      .object({
        ids: z
          .array(z.string())
          .optional()
          .describe("Specific session IDs to target."),
        target: z
          .enum([
            "unregistered",
            "active",
            "needs_attention",
            "terminal",
            "tracked",
            "all",
          ])
          .optional()
          .describe(
            "Target groups: 'unregistered' (not yet acknowledged), 'tracked' (in my list), 'active' (non-terminal states), 'needs_attention' (awaiting plan approval, user feedback, or paused), 'terminal' (completed/failed), or 'all'.",
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
            "CLIENT-SIDE filter by Jules session state(s). Can specify multiple states as array. Use 'all' for no state filter. Note: Jules API does not support server-side state filtering; filtering is performed locally after fetching sessions.",
          ),
        since: z
          .enum(["1h", "6h", "24h", "7d", "30d", "all"])
          .optional()
          .describe(
            "Filter target by creation time. Only applies when 'target' is used.",
          ),
      })
      .refine(
        (s) => s.ids || s.target,
        "Must provide either 'ids' or 'target'.",
      ),
    prefs: z
      .object({
        approval: z.enum(["auto", "confirm", "strict"]).optional(),
        verbosity: z.enum(["silent", "milestones", "full"]).optional(),
      })
      .optional()
      .describe(
        "Used with CONFIGURE action to reconfigure sessions' approval/verbosity preferences.",
      ),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      console.log(`[manage_sessions] Action: ${args.action}, selection: ${JSON.stringify({ ids: args.selection.ids?.length, target: args.selection.target })}`);
      const result = (await ctx.runAction(
        internal.sessions.sessionManager.getAllSessionsBasic,
        { userId: ctx.userId },
      )) as SessionQueryResult;

      if (!result.success) {
        console.error(`[manage_sessions] Failed to fetch sessions`);
        return "Error: Failed to fetch sessions for bulk operation.";
      }

      const sessions = result.sessions;
      let targetIds: string[] = args.selection.ids || [];

      if (args.selection.target) {
        let filtered = sessions;

        // Apply state filter
        if (args.selection.state && !args.selection.state.includes("all")) {
          const states = args.selection.state.map((s) => s.toUpperCase());
          filtered = filtered.filter((s: SessionInfo) => {
            const normalized = normalizeState(s.state);
            return states.includes(normalized);
          });
        }

        // Apply time filter
        if (args.selection.since && args.selection.since !== "all") {
          const sinceHours: Record<string, number> = {
            "1h": 1,
            "6h": 6,
            "24h": 24,
            "7d": 168,
            "30d": 720,
          };
          const hours = sinceHours[args.selection.since] || 0;
          const cutoff = Date.now() - hours * 60 * 60 * 1000;
          filtered = filtered.filter((s: SessionInfo) => {
            const created = s.lastActivity
              ? new Date(s.lastActivity).getTime()
              : 0;
            return created >= cutoff;
          });
        }

        // Apply target group filter
        const groupFiltered = filtered.filter((s: SessionInfo) => {
          const st = normalizeState(s.state);
          switch (args.selection.target) {
            case "unregistered":
              return !s.acknowledged;
            case "tracked":
              return s.inDashboard;
            case "active":
              return st !== "COMPLETED" && st !== "FAILED";
            case "needs_attention":
              return needsUserAction(st);
            case "terminal":
              return st === "COMPLETED" || st === "FAILED";
            case "all":
              return true;
            default:
              return false;
          }
        });
        const groupIds = groupFiltered.map((s: SessionInfo) => s.julesSessionId);
        targetIds = Array.from(new Set([...targetIds, ...groupIds]));
      }

      if (targetIds.length === 0) {
        console.log(`[manage_sessions] No sessions matched selection`);
        return "No sessions matched the selection.";
      }

      const updates: SessionUpdatePatch = {};
      if (args.action === "REGISTER") updates.acknowledged = true;
      if (args.action === "TRACK") {
        updates.inDashboard = true;
        updates.acknowledged = true;
      }
      if (args.action === "ARCHIVE") updates.inDashboard = false;
      if (args.prefs) updates.prefs = args.prefs;

      console.log(`[manage_sessions] Performing ${args.action} on ${targetIds.length} session(s)`);
      await ctx.runMutation(internal.sessions.db.bulkUpdateSessions, {
        julesSessionIds: targetIds,
        updates,
      });

      // Task list management for TRACK and ARCHIVE
      if (args.action === "TRACK" && ctx.threadId) {
        // Assign threadId to discovered sessions + create task lists for all
        await ctx.runMutation(internal.sessions.db.assignThreadAndInitTasks, {
          julesSessionIds: targetIds,
          threadId: ctx.threadId,
        });
      }

      if (args.action === "ARCHIVE" && ctx.threadId) {
        // Delete task lists for archived sessions
        for (const id of targetIds) {
          await ctx.runMutation(internal.tasks.deleteTasksForSession, {
            threadId: ctx.threadId,
            julesSessionId: id,
          });
        }
      }

      return `Successfully performed ${args.action} on ${targetIds.length} sessions.`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[manage_sessions] Error:`, msg);
      return `Error managing sessions: ${msg}`;
    }
  },
});

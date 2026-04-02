import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { spawnSessionManagerAgent } from "../sessions/sessionManagerAgent";
import { resolveLanguageModel } from "../agent/modelResolver";
import type { SessionQueryResult, SessionInfo, SessionUpdatePatch, FileRegistrationResult, JulesSessionState } from "../types";
import { normalizeState, needsUserAction } from "../types";

export const message_jules = createTool({
  description:
    "Send a message (prompt) to the agent in the context of an existing Jules session.",
  inputSchema: z.object({
    julesSessionId: z
      .string()
      .describe("The ID of the Jules session to send the message to."),
    prompt: z
      .string()
      .describe("The message or instruction to send to the Jules agent."),
  }),
  execute: async (ctx, args): Promise<string> => {
    const res = await ctx.runAction(
      internal.sessions.actions.sendMessage,
      { sessionId: args.julesSessionId, prompt: args.prompt },
    );
    if (res.success) {
      return `Message sent successfully to session ${args.julesSessionId}`;
    } else {
      return `Error sending message: ${res.error}`;
    }
  },
});

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
    const res = await ctx.runAction(
      internal.sessions.actions.approvePlan,
      { sessionId: args.julesSessionId },
    );
    if (res.success) {
      return `Plan approved successfully for session ${args.julesSessionId}`;
    } else {
      return `Error approving plan: ${res.error}`;
    }
  },
});

export const message_user = createTool({
  description:
    "Send a direct message to the human user on Telegram. MUST be used for all responses. Format with Telegram HTML tags: <b>bold</b>, <i>italic</i>, <code>code</code>, <a href='url'>link</a>.",
  inputSchema: z.object({
    message: z
      .string()
      .describe(
        "The message text to send to the user, formatted in Telegram HTML.",
      ),
  }),
  execute: async (ctx, args): Promise<string> => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
    const res = await ctx.runAction(
      internal.sessions.actions.sendTelegramMessage,
      {
        threadId: ctx.threadId,
        message: args.message,
      },
    );
    if (res.success) {
      return `Message successfully sent to the user on Telegram.`;
    } else {
      return `Error sending message: ${res.error}`;
    }
  },
});

export const create_session = createTool({
  description:
    "Create a new Jules session. If a repository or branch is invalid or the GitHub integration has expired, an error will be returned. DO NOT crash, simply return the error back to the user and ask for the correct details.",
  inputSchema: z.object({
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
        verbosity: z.enum(["silent", "milestones", "full"]).default("milestones"),
      })
      .optional()
      .describe(
        "Session interaction preferences toward the user. approval: when to ask permission (auto=act first, confirm=ask before irreversible, strict=ask before most). verbosity: how much to report (silent=outcomes only, milestones=key progress, full=ongoing updates).",
      ),
  }).refine(
    (data) => !(data.githubRepo && !data.baseBranch),
    {
      message: "baseBranch is required when githubRepo is provided",
      path: ["baseBranch"],
    }
  ),
  execute: async (ctx, args): Promise<string> => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");

    const res = await ctx.runAction(
      internal.sessions.actions.createSession,
      {
        threadId: ctx.threadId,
        prompt: args.prompt,
        title: args.title,
        githubRepo: args.githubRepo,
        baseBranch: args.baseBranch,
        requireApproval: args.requireApproval,
        autoPr: args.autoPr,
        ...(args.prefs ? { prefs: args.prefs } : {}),
      },
    );

    if (!res.success || !res.id) {
      return `Error creating session: ${res.error}. Please check the repository, branch, and ensure GitHub integration is active.`;
    }

    const shortName = args.title || res.id.slice(0, 8);

    await ctx.runMutation(internal.sessions.db.addSession, {
      threadId: ctx.threadId,
      julesSessionId: res.id,
      shortName,
      repo: args.githubRepo,
      ...(args.prefs ? { prefs: args.prefs } : {}),
    });

    return `Session created successfully! Session ID: ${res.id}. Remember to note the session ID.`;
  },
});

export const update_task_list = createTool({
  description:
    "Update or create a persistent task list/note identified by a key. This plan is automatically injected into your context for future turns. Use this to maintain your global plan, session-specific goals, or research notes.",
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
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
    await ctx.runMutation(internal.tasks.upsertTasks, {
      threadId: ctx.threadId,
      key: args.key,
      content: args.content,
    });
    return `Successfully updated task list '${args.key}'.`;
  },
});

export const delete_task_list = createTool({
  description: "Delete a persistent task list/note identified by its key.",
  inputSchema: z.object({
    key: z.string().describe("The name or key of the task list to delete."),
  }),
  execute: async (ctx, args): Promise<string> => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
    await ctx.runMutation(internal.tasks.deleteTasks, {
      threadId: ctx.threadId,
      key: args.key,
    });
    return `Successfully deleted task list '${args.key}'.`;
  },
});

export {
  exa_search,
  exa_get_contents,
  exa_find_similar,
  research,
} from "./exa_search";

export const handle_files = createTool({
  description:
    "Process files from your 'Inbox' (unregistered files). You MUST run this tool to formally name files before you can analyze them. Name files logically using kebab-case (e.g. 'sales-plan.md') based on their caption or original name. Can also delete files but you MUST ask the user for approval first as they will need to resend the file if deleted.",
  inputSchema: z.object({
    registrations: z
      .array(
        z.object({
          fileId: z
            .string()
            .describe("The ID of the uploaded file from the Inbox."),
          assignedName: z
            .string()
            .describe(
              "The new logical kebab-case name for the file (e.g. 'api-docs.md').",
            ),
          action: z
            .enum(["register", "delete"])
            .describe(
              "Choose 'register' to keep and name the file, or 'delete' to discard it.",
            ),
        }),
      )
      .describe("List of files to process."),
  }),
  execute: async (ctx, args): Promise<string> => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");
    const results = await ctx.runMutation(
      internal.files.db.registerFiles,
      {
        threadId: ctx.threadId,
        registrations: args.registrations.map(reg => ({
          fileId: reg.fileId as unknown as import("../_generated/dataModel").Id<"uploadedFiles">,
          assignedName: reg.assignedName,
          action: reg.action,
        })),
      },
    );

    return (
      `Processed ${results.length} files:\n` +
      results
        .map((r: FileRegistrationResult) => {
          if ("success" in r && r.success) {
            return `- ID: ${r.id} -> ${"action" in r ? r.action : "registered"} ${"name" in r && r.name ? `as '${String(r.name)}'` : ""}`;
          } else if ("error" in r) {
            return `- ID: ${r.id} -> failed: ${String(r.error)}`;
          }
          return `- ID: ${r.id} -> processed`;
        })
        .join("\n")
    );
  },
});

/**
 * query_sessions — Browse and manage the user's Jules sessions.
 * Spawns a session manager sub-agent with all sessions in context.
 */
export const query_sessions = createTool({
  description:
    "Browse, search, inspect, and manage the user's Jules sessions. Discovers sessions from the Jules API on-demand. Spawns a session manager sub-agent with filtering support (time, state, fuzzy search).",
  inputSchema: z.object({
    prompt: z.string().optional().describe(
      "What the user wants to do — e.g. 'find active sessions from today', 'show failed sessions from last week', 'track all sessions about auth', 'register all unregistered sessions'. If omitted, defaults to 'Show me my sessions and let me know if any need attention.'",
    ),
  }),
  execute: async (ctx, args): Promise<string> => {
    const result = await ctx.runAction(
      internal.sessions.sessionManager.getAllSessionsWithInfo,
      {},
    ) as SessionQueryResult;

    if (!result.success) {
      return `Error: ${result.error || "Failed to fetch sessions"}`;
    }

    const sessions = result.sessions || [];
    const prompt = args.prompt|| "Show me my sessions and let me know if any need attention.";

    if (!ctx.threadId) throw new Error("Tool must be called within a thread context.");
    
    const model = await resolveLanguageModel(ctx, ctx.threadId);
    return spawnSessionManagerAgent(ctx, sessions, prompt, ctx.threadId, model);
  },
});

/**
 * manage_sessions — Bulk manage Jules sessions.
 */
export const manage_sessions = createTool({
  description: "Bulk manage Jules sessions. REGISTER: acknowledge unregistered sessions. TRACK: add to dashboard. ARCHIVE: remove tracked sessions from dashboard (untrack). CONFIGURE: update preferences.",
  inputSchema: z.object({
    action: z.enum(["REGISTER", "TRACK", "ARCHIVE", "CONFIGURE"])
      .describe("REGISTER: Acknowledge unregistered sessions. TRACK: Add to dashboard. ARCHIVE: Remove tracked sessions from dashboard (untrack). CONFIGURE: Update prefs."),
    selection: z.object({
      ids: z.array(z.string()).optional().describe("Specific session IDs to target."),
      target: z.enum(["unregistered", "active", "needs_attention", "terminal", "tracked", "all"]).optional()
        .describe("Target groups: 'unregistered' (not yet acknowledged), 'tracked' (in dashboard), 'active' (non-terminal states), 'needs_attention' (awaiting plan approval, user feedback, or paused), 'terminal' (completed/failed), or 'all'."),
      state: z.array(z.enum([
        "STATE_UNSPECIFIED", "QUEUED", "PLANNING", "AWAITING_PLAN_APPROVAL",
        "AWAITING_USER_FEEDBACK", "IN_PROGRESS", "PAUSED", "FAILED", "COMPLETED", "all"
      ])).optional()
        .describe("CLIENT-SIDE filter by Jules session state(s). Can specify multiple states as array. Use 'all' for no state filter. Note: Jules API does not support server-side state filtering; filtering is performed locally after fetching sessions."),
      since: z.enum(["1h", "6h", "24h", "7d", "30d", "all"]).optional()
        .describe("Filter target by creation time. Only applies when 'target' is used."),
    }).refine(s => s.ids || s.target, "Must provide either 'ids' or 'target'."),
    prefs: z.object({
      approval: z.enum(["auto", "confirm", "strict"]).optional(),
      verbosity: z.enum(["silent", "milestones", "full"]).optional(),
    }).optional().describe("Optional bulk update for preferences (approval/verbosity)."),
  }),
  execute: async (ctx, args): Promise<string> => {
    const result = await ctx.runAction(
      internal.sessions.sessionManager.getAllSessionsBasic,
      {},
    ) as SessionQueryResult;

    if (!result.success) return "Error: Failed to fetch sessions for bulk operation.";

    const sessions = result.sessions;
    let targetIds: string[] = args.selection.ids || [];

    if (args.selection.target) {
      let filtered = sessions;

      // Apply state filter
      if (args.selection.state && !args.selection.state.includes("all")) {
        const states = args.selection.state.map(s => s.toUpperCase());
        filtered = filtered.filter((s: SessionInfo) => {
          const normalized = normalizeState(s.state);
          return states.includes(normalized);
        });
      }

      // Apply time filter
      if (args.selection.since && args.selection.since !== "all") {
        const sinceHours: Record<string, number> = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };
        const hours = sinceHours[args.selection.since] || 0;
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        filtered = filtered.filter((s: SessionInfo) => {
          const created = s.lastActivity ? new Date(s.lastActivity).getTime() : 0;
          return created >= cutoff;
        });
      }

      // Apply target group filter
      const groupFiltered = filtered.filter((s: SessionInfo) => {
        const st = normalizeState(s.state);
        switch (args.selection.target) {
          case "unregistered": return !s.acknowledged;
          case "tracked": return s.inDashboard;
          case "active": return st !== "COMPLETED" && st !== "FAILED";
          case "needs_attention": return needsUserAction(st);
          case "terminal": return st === "COMPLETED" || st === "FAILED";
          case "all": return true;
          default: return false;
        }
      });
      const groupIds = groupFiltered.map((s: SessionInfo) => s.julesSessionId);
      targetIds = Array.from(new Set([...targetIds, ...groupIds]));
    }

    if (targetIds.length === 0) return "No sessions matched the selection.";

    const updates: SessionUpdatePatch = {};
    if (args.action === "REGISTER") updates.acknowledged = true;
    if (args.action === "TRACK") {
      updates.inDashboard = true;
      updates.acknowledged = true;
    }
    if (args.action === "ARCHIVE") updates.inDashboard = false;
    if (args.prefs) updates.prefs = args.prefs;

    await ctx.runMutation(internal.sessions.db.bulkUpdateSessions, {
      julesSessionIds: targetIds,
      updates,
    });

    return `Successfully performed ${args.action} on ${targetIds.length} sessions.`;
  },
});

/**
 * fetch_session_files — Extract file(s) from a Jules session.
 */
export const fetch_session_files = createTool({
  description:
    "Read or extract file(s) from a Jules session. Handles multiple file versions by always fetching the latest edit from the session outputs.\n" +
    "- send: Attach file(s) directly to Telegram chat as documents.\n" +
    "- show: Return content with instructions to display it in the chat via message_user.\n" +
    "- read: Return content for your internal context only without sending to the user.",
  inputSchema: z.object({
    julesSessionId: z.string().describe("The ID of the Jules session."),
    filePath: z.union([z.string(), z.array(z.string())]).describe(
      "Required. The exact path of the file(s) to fetch. Can be a single file path string or an array of file paths.",
    ),
    mode: z.enum(["show", "send", "read"]).optional().default("send").describe(
      "How to handle the file content.",
    ),
    asZip: z.boolean().optional().default(false).describe(
      "Bundle multiple files into a ZIP before sending. Only applies when mode is 'send'.",
    ),
  }),
  execute: async (ctx, args): Promise<string> => {
    const outputs = await ctx.runQuery(
      internal.sessions.db.getSessionOutputs,
      { julesSessionId: args.julesSessionId },
    );

    const latestFiles = new Map<string, string>();
    for (const out of outputs) {
      if (out && out.type === "changeSet" && out.extractedFiles) {
        for (const file of out.extractedFiles) {
          latestFiles.set(file.path, file.content);
        }
      }
    }

    if (latestFiles.size === 0) {
      return `Error: No files found in session '${args.julesSessionId}'.`;
    }

    const filesToProcess: { path: string; content: string }[] = [];
    const pathsToFetch = Array.isArray(args.filePath)
      ? args.filePath
      : [args.filePath];

    const notFound: string[] = [];
    for (const path of pathsToFetch) {
      if (!latestFiles.has(path)) {
        notFound.push(path);
      } else {
        filesToProcess.push({
          path,
          content: latestFiles.get(path)!,
        });
      }
    }

    if (notFound.length > 0) {
      return `Error: File(s) not found in session '${args.julesSessionId}': ${notFound.join(", ")}`;
    }

    if (args.mode === "send") {
      const sessionDoc = await ctx.runQuery(
        internal.sessions.db.getSessionByJulesId,
        { julesSessionId: args.julesSessionId },
      );
      if (!sessionDoc) return "Error: Session not found.";

      const chatId = await ctx.runQuery(
        internal.users.db.getChatIdForThread,
        { threadId: sessionDoc.threadId },
      );
      if (!chatId) return "Error: No Telegram Chat ID found for this session.";

      await ctx.runAction(internal.sessions.actions.sendTelegramMessage, {
        threadId: ctx.threadId!,
        message: `Uploading...`,
      });

      if (args.asZip && filesToProcess.length > 0) {
        const zipName = `${args.julesSessionId.slice(0, 8)}-files.zip`;
        const sendRes = await ctx.runAction(
          internal.tools.nodeActions.sendTelegramZipAction,
          { telegramChatId: chatId, files: filesToProcess, filename: zipName },
        );
        if (!sendRes.success) return `Error sending ZIP: ${sendRes.error}`;
        return `Successfully sent ${filesToProcess.length} file(s) as a ZIP archive.`;
      }

      for (const file of filesToProcess) {
        const filename = file.path.split("/").pop() || file.path;
        const sendRes = await ctx.runAction(
          internal.tools.nodeActions.sendTelegramDocumentAction,
          {
            telegramChatId: chatId,
            fileContent: file.content,
            filename,
          },
        );
        if (!sendRes.success)
          return `Error sending file '${file.path}': ${sendRes.error}`;
      }
      return `Successfully sent ${filesToProcess.length} file(s) to the user.`;
    }

    let combinedContent = "";
    for (const file of filesToProcess) {
      combinedContent += `[FILE: ${file.path}]\n${file.content}\n\n`;
    }

    if (args.mode === "show") {
      return (
        `Here are the requested file(s):\n\n${combinedContent}\n` +
        `To show this to the user, you MUST use the 'message_user' tool and wrap the code with Telegram HTML:\n` +
        `<pre><code class="language-typescript">\n// content\n</code></pre>`
      );
    }

    return combinedContent.trim();
  },
});

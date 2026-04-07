import { Agent, createTool } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { message_jules, approve_plan } from "../tools/index";
import { createReportToOrchestratorTool } from "../tools/reportToOrchestrator";
import { resolveLanguageModel } from "../agent/modelResolver";
import { isNonRetriableError } from "../utils/retry";

// ============================================================================
// Types
// ============================================================================

interface StoredActivity {
  _id: string;
  julesSessionId: string;
  type: string;
  createTime: number;
  summary: string;
  filesChanged?: string[];
}

interface TaskDoc {
  _id: string;
  _creationTime: number;
  threadId: string;
  key: string;
  content: string;
}

// ============================================================================
// Agent Instructions
// ============================================================================

const sessionHandlerInstructions = `You handle events for one Jules coding session. You report to an orchestrator agent.

## Your Job
1. Observe the new activities for this session
2. Follow the session's task list plan
3. Take action if appropriate (approve plans, send follow-ups to Jules)
4. Update the session task list to reflect current progress
5. Report to the orchestrator

## Mandatory Steps (in order)
1. Review activities and task list
2. Take any needed actions (message_jules, approve_plan)
3. Update the session task list via update_task_list — REQUIRED before reporting
4. Call report_to_orchestrator — REQUIRED. Your ONLY output channel.

## Task List
The session task list (key: "session:{sessionId}:tasks") is the plan for this session.
- Follow it as your guide
- Mark items as done when completed
- Add new items if you discover additional work needed
- Always update it before reporting

## Tools
- message_jules: Send follow-up to the Jules session if the event requires it.
- approve_plan: Approve a pending plan. Use when the plan is straightforward.
- update_task_list: Update the session task list. Key: "session:{sessionId}:tasks".
- report_to_orchestrator: REQUIRED. Report what happened and what you did.`;

// ============================================================================
// Context Formatter
// ============================================================================

function formatEventContext(args: {
  julesSessionId: string;
  shortName: string;
  repo?: string;
  currentState: string;
  previousState?: string;
  triggeringActivities: any[];
  allActivities: StoredActivity[];
  taskContent: string;
}): string {
  const lines: string[] = [];

  // Session info
  lines.push("## SESSION");
  lines.push(`ID: ${args.julesSessionId}`);
  lines.push(`Title: ${args.shortName}`);
  if (args.repo) lines.push(`Repo: ${args.repo}`);
  lines.push(
    `State: ${args.previousState || "unknown"} → ${args.currentState}`,
  );

  // All activities
  lines.push("\n## ALL ACTIVITIES (chronological, newest last)");
  for (const act of args.allActivities) {
    const ts = new Date(act.createTime).toISOString();
    let line = `[${ts}] ${act.type}: ${act.summary}`;
    if (act.filesChanged && act.filesChanged.length > 0) {
      line += `\n  Files: ${act.filesChanged.join(", ")}`;
    }
    lines.push(line);
  }

  // New activities (triggering)
  lines.push("\n## NEW ACTIVITIES (this wake)");
  for (const act of args.triggeringActivities) {
    const ts = new Date(act.createTime).toISOString();
    lines.push(`[${ts}] ${act.type}: ${act.message || act.title || act.description || act.type}`);
  }

  // Task list
  lines.push("\n## TASK LIST");
  lines.push(`[KEY: session:${args.julesSessionId}:tasks]`);
  lines.push(args.taskContent);

  return lines.join("\n");
}

// ============================================================================
// Scoped Update Task List Tool
// ============================================================================

function createScopedUpdateTaskTool(
  mainThreadId: string,
  julesSessionId: string,
) {
  return createTool({
    description: `Update the session task list. Key: "session:${julesSessionId}:tasks".`,
    inputSchema: z.object({
      content: z
        .string()
        .describe("The full markdown content of the updated task list."),
    }),
    execute: async (ctx, args) => {
      await ctx.runMutation(internal.tasks.upsertTasks, {
        threadId: mainThreadId,
        key: `session:${julesSessionId}:tasks`,
        content: args.content,
      });
      return "Task list updated.";
    },
  });
}

// ============================================================================
// Spawn Function
// ============================================================================

export async function spawnSessionEventHandler(
  ctx: ActionCtx,
  args: {
    mainThreadId: string;
    julesSessionId: string;
    shortName: string;
    repo?: string;
    currentState: string;
    previousState?: string;
    triggeringActivities: any[];
    allActivities: StoredActivity[];
    tasks: TaskDoc[];
  },
): Promise<void> {
  // Resolve model inside the handler (cannot pass LanguageModel objects through action args)
  const model = await resolveLanguageModel(ctx, args.mainThreadId);

  // Find this session's task list
  const sessionTaskKey = `session:${args.julesSessionId}:tasks`;
  const sessionTask = args.tasks.find((t) => t.key === sessionTaskKey);
  const taskContent = sessionTask?.content || "(no task list found)";

  // Build context messages from main thread
  const mainAgent = new Agent(components.agent, {
    name: "Session Handler Context Fetcher",
    languageModel: model as any,
  });

  let mainContextMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  try {
    const mainMessages = await mainAgent.fetchContextMessages(ctx, {
      userId: undefined,
      threadId: args.mainThreadId,
      contextOptions: {
        recentMessages: 25,
        excludeToolMessages: true,
      },
    });
    mainContextMessages = mainMessages
      .filter(
        (m) =>
          m.message &&
          (m.message.role === "user" || m.message.role === "assistant"),
      )
      .map((m) => ({
        role: m.message!.role as "user" | "assistant",
        content:
          typeof m.message!.content === "string"
            ? m.message!.content
            : JSON.stringify(m.message!.content),
      }));
  } catch (err) {
    console.error(
      `[sessionEventHandler] Failed to fetch main thread context: ${err}`,
    );
    // Continue without main context
  }

  // Format event context
  const eventContext = formatEventContext({
    julesSessionId: args.julesSessionId,
    shortName: args.shortName,
    repo: args.repo,
    currentState: args.currentState,
    previousState: args.previousState,
    triggeringActivities: args.triggeringActivities,
    allActivities: args.allActivities,
    taskContent,
  });

  const eventMessage = { role: "user" as const, content: eventContext };

  // Create scoped tools
  const scopedReportToOrchestrator = createReportToOrchestratorTool(
    args.mainThreadId,
    {
      julesSessionId: args.julesSessionId,
      shortName: args.shortName,
    },
  );

  const scopedUpdateTaskList = createScopedUpdateTaskTool(
    args.mainThreadId,
    args.julesSessionId,
  );

  // Create the session handler agent
  const handlerAgent = new Agent(components.agent, {
    name: `Session Handler: ${args.shortName}`,
    languageModel: model as any,
    instructions: sessionHandlerInstructions,
    maxSteps: 15,
    tools: {
      message_jules,
      approve_plan,
      report_to_orchestrator: scopedReportToOrchestrator,
      update_task_list: scopedUpdateTaskList,
    },
  });

  // Create ephemeral thread, generate, delete
  const thread = await handlerAgent.createThread(ctx, {
    title: `Event: ${args.shortName} - ${args.currentState}`,
  });

  try {
    await handlerAgent.generateText(
      ctx,
      { threadId: thread.threadId },
      {
        messages: [...mainContextMessages, eventMessage],
        prompt: "Handle this session event.",
      },
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[sessionEventHandler] Handler failed for ${args.julesSessionId}: ${errorMsg}`,
    );

    // Don't re-inject non-retriable errors (quota, auth) into the main queue —
    // it creates an infinite cron→error→wake→error loop
    if (isNonRetriableError(error)) {
      console.warn(
        `[sessionEventHandler] Non-retriable error for ${args.julesSessionId}, not waking main agent`,
      );
      return;
    }

    // Report failure to orchestrator so the main agent knows
    try {
      await ctx.runMutation(internal.users.db.appendPendingMessage, {
        threadId: args.mainThreadId,
        text: `[SESSION REPORT: ${args.shortName}] Handler failed: ${errorMsg}`,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.tools.reportToOrchestrator.wakeMainAgent,
        { mainThreadId: args.mainThreadId },
      );
    } catch (reportErr) {
      console.error(
        `[sessionEventHandler] Failed to report error to orchestrator: ${reportErr}`,
      );
    }
  } finally {
    try {
      await handlerAgent.deleteThreadAsync(ctx, {
        threadId: thread.threadId,
      });
    } catch {
      // Silently ignore cleanup errors
    }
  }
}

// ============================================================================
// Internal Action Wrapper (required for ctx.runAction from polling)
// ============================================================================

export const spawnHandler = internalAction({
  args: {
    mainThreadId: v.string(),
    julesSessionId: v.string(),
    shortName: v.string(),
    repo: v.optional(v.string()),
    currentState: v.string(),
    previousState: v.optional(v.string()),
    triggeringActivities: v.array(v.any()),
    allActivities: v.array(v.any()),
    tasks: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    await spawnSessionEventHandler(ctx, args);
  },
});

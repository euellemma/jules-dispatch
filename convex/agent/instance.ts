import { Agent, type ContextHandler } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { systemInstructions } from "./instructions";
import * as tools from "../tools";
import { internal } from "../_generated/api";
import { resolveLanguageModel } from "./modelResolver";

export { resolveLanguageModel };

interface MemoryDoc {
  activeObservations?: string;
  lastObservedAt: number;
}

interface JulesSession {
  julesSessionId: string;
  shortName?: string;
  lastKnownState?: string;
  inDashboard: boolean;
  acknowledged: boolean;
  repo?: string;
  origin?: string;
  prefs?: {
    approval?: string;
    verbosity?: string;
  };
  lastActivity?: string;
  outputCount: number;
}

interface FileDoc {
  _id: string;
  originalName: string;
  caption?: string;
  size: number;
  assignedName?: string;
  status: string;
}

interface TaskDoc {
  key: string;
  content: string;
}

export const unifiedContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, allMessages } = args;
  if (!threadId) return allMessages;

  // Fetch all context data in parallel
  const [memory, sessions, tasks, files, sessionFileCounts] = await Promise.all([
    ctx.runQuery(internal.memory.db.getMemory, {
      threadId,
    }) as Promise<MemoryDoc | null>,
    ctx.runQuery(internal.sessions.db.getAllSessions, {}) as Promise<
      JulesSession[]
    >,
    ctx.runQuery(internal.tasks.listTasksForThread, { threadId }) as Promise<
      TaskDoc[]
    >,
    ctx.runQuery(internal.files.db.getThreadFiles, { threadId }) as Promise<
      FileDoc[]
    >,
    ctx.runQuery(internal.sessions.db.getSessionOutputCounts, { threadId }) as Promise<
      Record<string, number>
    >,
  ]);

  // Initialize memory if needed
  if (!memory) {
    await ctx.runMutation(internal.memory.db.initializeMemory, { threadId });
  }

  // Schedule observation compaction (fire-and-forget)
  ctx.runMutation(internal.memory.processor.scheduleObservation, { threadId });

  // Filter messages based on memory's lastObservedAt
  const filteredMessages = (allMessages as any[]).filter((m) => {
    if (!m._creationTime) return true;
    return m._creationTime > (memory?.lastObservedAt || 0);
  });

  // Build context messages
  const contextMessages: Array<{ role: "user"; content: string }> = [];

  // 1. Memory observations
  if (memory?.activeObservations) {
    contextMessages.push({
      role: "user",
      content: `# Observations (Summary of earlier conversation)\n${memory.activeObservations}`,
    });
  }

  // 2. My list
  const dashboardSessions = sessions.filter((s) => s.inDashboard);
  if (dashboardSessions.length > 0) {
    const rows = dashboardSessions
      .map((s) => {
        const prefs = s.prefs
          ? `${s.prefs.approval || "confirm"}/${s.prefs.verbosity || "milestones"}`
          : "confirm/milestones";
        const fileCount = sessionFileCounts[s.julesSessionId] || 0;
        const filesCol = fileCount > 0 ? `+${fileCount}` : "-";
        return `| ${s.julesSessionId} | ${s.shortName || "untitled"} | ${s.lastKnownState || "unknown"} | ${s.repo || "repoless"} | ${prefs} | ${s.origin || "discovered"} | ${filesCol} |`;
      })
      .join("\n");

    contextMessages.push({
      role: "user",
      content: `### MY LIST\n\n**Tracked Sessions (${dashboardSessions.length}):**\n| ID | Title | State | Repo | Prefs | Origin | Files |\n|---|---|---|---|---|---|---|\n${rows}\n\nUse message_user for all responses. Format for Telegram HTML.`,
    });
  }

  // 3. Tasks
  if (tasks.length > 0) {
    const formattedTasks = tasks
      .map((t) => `[KEY: ${t.key}]\n${t.content}`)
      .join("\n\n---\n\n");
    contextMessages.push({
      role: "user",
      content: `### CURRENT PROJECT todo/task LISTS\n\n${formattedTasks}\n\nUse the update_task_list tool to maintain these lists. This is your project's persistent memory and source of truth for goals and progress.`,
    });
  }

  // 4. Inbox (unregistered files only)
  const unregisteredFiles = files.filter((f) => f.status === "unregistered");
  if (unregisteredFiles.length > 0) {
    let inboxMsg = `### INBOX\nUnregistered files. Use vfs(action: "register", ...) to rename them.\n\n`;
    unregisteredFiles.forEach((f) => {
      inboxMsg += `- /uploads/_inbox/${f.originalName}        ${Math.round(f.size / 1024)}KB  Caption: ${f.caption || "(none)"}\n`;
    });
    inboxMsg += `\nBrowse all files: vfs(action: "ls")`;

    contextMessages.push({
      role: "user",
      content: inboxMsg,
    });
  }

  // 5. Pre-call notifications for slow tools
  contextMessages.push({
    role: "user",
    content: `### SLOW TOOLS
Before calling these, send a brief message_user notification:
- research → "Searching..."
- vfs send → "Sending..."
- query_sessions → "Checking..."
Pattern: notify → call tool → respond naturally.

You MUST use the message_user tool for EVERY SINGLE RESPONSE. Direct output is captured as internal notes, not shown to the user. If you don't use message_user, the user won't see your response.
`,
  });

  return [...filteredMessages, ...contextMessages];
};

export const julesAgent = new Agent(components.agent, {
  name: "Jules Dispatch",
  languageModel: (() => {
    throw new Error("Model must be passed explicitly via generateText options");
  }) as any,
  instructions: systemInstructions,
  contextHandler: unifiedContextHandler,
  maxSteps: 50,
  tools: {
    create_session: tools.create_session,
    message_jules: tools.message_jules,
    approve_plan: tools.approve_plan,
    manage_sessions: tools.manage_sessions,
    update_task_list: tools.update_task_list,
    delete_task_list: tools.delete_task_list,
    vfs: tools.vfs,
    research: tools.research,
    message_user: tools.message_user,
    query_sessions: tools.query_sessions,
  },
});

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
  const [memory, sessions, tasks, files] = await Promise.all([
    ctx.runQuery(internal.memory.db.getMemory, { threadId }) as Promise<MemoryDoc | null>,
    ctx.runQuery(internal.sessions.db.getAllSessions, {}) as Promise<JulesSession[]>,
    ctx.runQuery(internal.tasks.listTasksForThread, { threadId }) as Promise<TaskDoc[]>,
    ctx.runQuery(internal.files.db.getThreadFiles, { threadId }) as Promise<FileDoc[]>,
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

  // 2. Session dashboard
  const dashboardSessions = sessions.filter(s => s.inDashboard);
  if (dashboardSessions.length > 0) {
    const rows = dashboardSessions.map((s) => {
      const prefs = s.prefs ? `${s.prefs.approval || "confirm"}/${s.prefs.verbosity || "milestones"}` : "confirm/milestones";
      return `| ${s.julesSessionId} | ${s.shortName || "untitled"} | ${s.lastKnownState || "unknown"} | ${s.repo || "repoless"} | ${prefs} | ${s.origin || "discovered"} |`;
    }).join("\n");

    contextMessages.push({
      role: "user",
      content: `### JULES SESSION DASHBOARD\n\n**Tracked Sessions (${dashboardSessions.length}):**\n| ID | Title | State | Repo | Prefs | Origin |\n|---|---|---|---|---|---|\n${rows}\n\nUse message_user for all responses. Format for Telegram HTML.`,
    });
  }

  // 3. Tasks
  if (tasks.length > 0) {
    const formattedTasks = tasks.map((t) => `[KEY: ${t.key}]\n${t.content}`).join("\n\n---\n\n");
    contextMessages.push({
      role: "user",
      content: `### CURRENT PROJECT todo/task LISTS\n\n${formattedTasks}\n\nUse the update_task_list tool to maintain these lists. This is your project's persistent memory and source of truth for goals and progress.`,
    });
  }

  // 4. Files
  if (files.length > 0) {
    const unregistered = files.filter((f) => f.status === "unregistered");
    const registered = files.filter((f) => f.status === "registered");

    let filesDashboard = `### UPLOADED FILES\n\n`;

    if (unregistered.length > 0) {
      filesDashboard += `**Inbox (Unregistered)**\nThe following files were just uploaded. Use 'handle_files' in the background to name them logically (e.g. 'sales-plan.md') based on the caption/original name. Once registered, you can analyze them.\n`;
      unregistered.forEach((f) => {
        filesDashboard += `- ID: ${f._id} | Original Name: ${f.originalName} | Caption: ${f.caption || "None"} | Size: ${Math.round(f.size / 1024)}KB\n`;
      });
      filesDashboard += `\n`;
    }

    if (registered.length > 0) {
      filesDashboard += `**Registered Files**\nYou can analyze these using the 'research' tool:\n`;
      registered.forEach((f) => {
        filesDashboard += `- ID: ${f._id} | Name: ${f.assignedName} | Size: ${Math.round(f.size / 1024)}KB\n`;
      });
      filesDashboard += `\n`;
    }

    contextMessages.push({
      role: "user",
      content: filesDashboard,
    });
  }

  // 5. Pre-call notifications for slow tools
  contextMessages.push({
    role: "user",
    content: `### SLOW TOOLS
Before calling these, send a brief message_user notification:
- create_session → "Starting session..."
- approve_plan → "Approving..."
- research → "Searching..."
- fetch_session_files → "Fetching..."
- query_sessions → "Checking..."

Pattern: notify → call tool → respond naturally.`,
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
    handle_files: tools.handle_files,
    research: tools.research,
    message_user: tools.message_user,
    query_sessions: tools.query_sessions,
    fetch_session_files: tools.fetch_session_files,
  },
});

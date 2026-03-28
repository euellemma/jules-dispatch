import { Agent, type ContextHandler } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { systemInstructions } from "./instructions";
import * as tools from "../tools";
import { internal } from "../_generated/api";
import { resolveLanguageModel } from "./modelResolver";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export { resolveLanguageModel };

console.log("[INSTANCE] Module loading");

// Initialize the default fallback provider
const fallbackProvider = createOpenAICompatible({
  name: "opencode",
  baseURL: "https://opencode.ai/zen/v1",
  apiKey: process.env.OPENCODE_GO_API_KEY,
});

interface MemoryDoc {
  activeObservations?: string;
  lastObservedAt: number;
}

const memoryContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, allMessages } = args;
  if (!threadId) return allMessages;

  const memory = (await ctx.runQuery(internal.memory.db.getMemory, {
    threadId,
  })) as MemoryDoc | null;

  if (!memory) {
    await ctx.runMutation(internal.memory.db.initializeMemory, {
      threadId,
    });
    return allMessages;
  }

  // OPTIMIZATION: Filter out raw messages that have already been summarized into observations
  // This prevents duplication and context bloat.
  // Note: allMessages contains the message history from the agent component.
  // Each message has a _creationTime if it came from the DB.
  const filteredMessages = (allMessages as any[]).filter((m) => {
    // If it's a new unsaved message or no creation time, keep it
    if (!m._creationTime) return true;
    // Keep it if it happened AFTER the last observation compaction
    return m._creationTime > (memory.lastObservedAt || 0);
  });

  if (!memory.activeObservations) {
    return filteredMessages;
  }

  const contextMessage = {
    role: "user" as const,
    content: `# Observations (Summary of earlier conversation)\n${memory.activeObservations}`,
  };

  ctx.runMutation(internal.memory.processor.scheduleObservation, {
    threadId,
  });

  return [...filteredMessages, contextMessage];
};

const tasksContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, allMessages } = args;
  if (!threadId) return allMessages;

  const tasks = (await ctx.runQuery(
    internal.tasks.listTasksForThread,
    {
      threadId,
    },
  )) as Array<{ key: string; content: string }>;

  if (tasks.length === 0) return allMessages;

  const formattedTasks = tasks
    .map((t) => `[KEY: ${t.key}]\n${t.content}`)
    .join("\n\n---\n\n");

  const contextMessage = {
    role: "user" as const,
    content: `### CURRENT PROJECT todo/task LISTS\n\n${formattedTasks}\n\nUse the update_task_list tool to maintain these lists. This is your project's persistent memory and source of truth for goals and progress.`,
  };

  return [...allMessages, contextMessage];
};

interface JulesSession {
  julesSessionId: string;
  shortName?: string;
  lastKnownState?: string;
  inDashboard: boolean;
}

const sessionContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, allMessages } = args;
  if (!threadId) return allMessages;

  const dashboardSessions = (await ctx.runQuery(
    internal.sessions.db.getDashboardSessions,
    {},
  )) as JulesSession[];

  const activeUntracked = (
    (await ctx.runQuery(
      internal.sessions.db.getActiveSessions,
      {},
    )) as JulesSession[]
  ).filter((s) => !s.inDashboard);

  const discoveredSessions = (await ctx.runQuery(
    internal.sessions.db.getUnacknowledgedSessions,
    {},
  )) as JulesSession[];

  if (
    dashboardSessions.length === 0 &&
    activeUntracked.length === 0 &&
    discoveredSessions.length === 0
  ) {
    return allMessages;
  }

  let context = `### JULES SESSION DASHBOARD\n`;

  // 1. Tracked Sessions (Warm)
  if (dashboardSessions.length > 0) {
    context += `**Tracked Sessions (${dashboardSessions.length}):**\n`;
    for (const s of dashboardSessions) {
      context += `- ${s.julesSessionId} | ${s.shortName || "untitled"} | ${
        s.lastKnownState || "unknown"
      }\n`;
    }
  }

  // 2. Active Untracked (Warm)
  if (activeUntracked.length > 0) {
    context += `\n**Active Untracked Sessions (${activeUntracked.length}):**\n`;
    for (const s of activeUntracked) {
      context += `- ${s.julesSessionId} | ${s.shortName || "untitled"} | ${
        s.lastKnownState || "unknown"
      }\n`;
    }
  }

  // 3. Summary of Discovered (Cold)
  if (discoveredSessions.length > 0) {
    context += `\n**Discovered Sessions:** ${discoveredSessions.length}\n`;
    if (discoveredSessions.length <= 10) {
      context += `IDs: ${discoveredSessions
        .map((s) => s.julesSessionId)
        .join(", ")}\n`;
      context += `Use 'manage_sessions(action: "REGISTER", selection: { target: "discovered" })' to acknowledge all.\n`;
    } else {
      context += `(More than 10 sessions discovered. Use 'query_sessions' to inspect or 'manage_sessions' to register all.)\n`;
    }
  }

  const contextMessage = {
    role: "user" as const,
    content: context,
  };

  const reminderMessage = {
    role: "user" as const,
    content: `Reminder: Use message_user for all responses. Format for Telegram HTML.`,
  };

  return [...allMessages, contextMessage, reminderMessage];
};

interface FileDoc {
  _id: string;
  originalName: string;
  caption?: string;
  size: number;
  assignedName?: string;
  status: string;
}

const filesContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, allMessages } = args;
  if (!threadId) return allMessages;

  const files = (await ctx.runQuery(internal.files.db.getThreadFiles, {
    threadId,
  })) as FileDoc[];

  if (files.length === 0) return allMessages;

  const unregistered = files.filter((f) => f.status === "unregistered");
  const registered = files.filter((f) => f.status === "registered");

  let dashboard = `### UPLOADED FILES\n\n`;

  if (unregistered.length > 0) {
    dashboard += `**Inbox (Unregistered)**\nThe following files were just uploaded. Use 'handle_files' in the background to name them logically (e.g. 'sales-plan.md') based on the caption/original name. Once registered, you can analyze them.\n`;
    unregistered.forEach((f) => {
      dashboard += `- ID: ${f._id} | Original Name: ${
        f.originalName
      } | Caption: ${f.caption || "None"} | Size: ${Math.round(
        f.size / 1024,
      )}KB\n`;
    });
    dashboard += `\n`;
  }

  if (registered.length > 0) {
    dashboard += `**Registered Files**\nYou can analyze these using the 'research' tool:\n`;
    registered.forEach((f) => {
      dashboard += `- ID: ${f._id} | Name: ${f.assignedName} | Size: ${Math.round(
        f.size / 1024,
      )}KB\n`;
    });
    dashboard += `\n`;
  }

  const contextMessage = {
    role: "user" as const,
    content: dashboard,
  };

  return [...allMessages, contextMessage];
};

const combinedContextHandler: ContextHandler = async (ctx, args) => {
  // 1. First, apply memory handler which will filter raw messages based on lastObservedAt
  const messagesWithMemory = await memoryContextHandler(ctx, args);

  // 2. Chain others using the filtered message list
  const messagesWithDashboard = await sessionContextHandler(ctx, {
    ...args,
    allMessages: messagesWithMemory,
  });
  const messagesWithTasks = await tasksContextHandler(ctx, {
    ...args,
    allMessages: messagesWithDashboard,
  });
  return await filesContextHandler(ctx, {
    ...args,
    allMessages: messagesWithTasks,
  });
};

export const julesAgent = new Agent(components.agent, {
  name: "Jules Dispatch",
  languageModel: fallbackProvider("big-pickle"),
  instructions: systemInstructions,
  contextHandler: combinedContextHandler,
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

import { Agent, type ContextHandler } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { systemInstructions } from "./instructions";
import * as tools from "../tools";
import { internal } from "../_generated/api";
import { resolveLanguageModel } from "./modelResolver";
import { logger } from "../utils/logger";

export { resolveLanguageModel };

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

interface MemoryEntry {
  content: string;
}

interface ThreadSummary {
  summary: string;
}

export const unifiedContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, userId, recent, search } = args;
  if (!threadId) return recent;
  if (!userId) return [...search, ...recent];

  const telegramChatId = userId;

  // Fetch all context data in parallel
  const [memoryEntries, userEntries, threadSummary, sessions, tasks, files, sessionFileCounts, nudgeCount, executorSources] = await Promise.all([
    ctx.runQuery(internal.memory.db.getEntries, { userId: telegramChatId, target: "memory" }),
    ctx.runQuery(internal.memory.db.getEntries, { userId: telegramChatId, target: "user" }),
    ctx.runQuery(internal.memory.db.getThreadSummary, { threadId }),
    ctx.runQuery(internal.sessions.db.getAllSessions, {}),
    ctx.runQuery(internal.tasks.listTasksForThread, { threadId }),
    ctx.runQuery(internal.files.db.getThreadFiles, { threadId }),
    ctx.runQuery(internal.sessions.db.getSessionOutputCounts, { threadId }),
    ctx.runQuery(internal.memory.db.getNudgeCount, { telegramChatId }),
    ctx.runQuery(internal.executor.db.listKv, { userId: telegramChatId, namespace: "tools" }),
  ]);

  // Build context messages
  const contextMessages: Array<{ role: "user"; content: string }> = [];

  // 0. Executor Capabilities (Connected Sources)
  const sources = (executorSources || []) as any[];
  if (sources.length > 0) {
    const sourceList = sources.map(s => {
      try {
        const val = JSON.parse(s.value);
        return `- ${s.key}: ${val.description || "No description"}`;
      } catch {
        return `- ${s.key}`;
      }
    }).join("\n");

    contextMessages.push({
      role: "user",
      content: `### EXECUTOR CAPABILITIES
You are connected to a remote Daytona Sandbox. Use the \`execute_code\` tool to run TypeScript.
Connected Libraries (use via the 'tools' object):
${sourceList}

If you need to use an API, write code that calls the library. Example: \`return await tools.github.user.getAuthenticated();\`
`,
    });
  }

  // 1. Thread summary (compacted older conversation)
  if (threadSummary?.summary) {
    contextMessages.push({
      role: "user",
      content: `### CONTEXT SUMMARY (earlier conversation compacted)\n${threadSummary.summary}`,
    });
  }

  // 2. Memory entries (agent's curated notes)
  if (memoryEntries.length > 0) {
    const content = memoryEntries.map(e => e.content).join("\n\u00a7\n");
    const pct = Math.round((content.length / 2200) * 100);
    contextMessages.push({
      role: "user",
      content: `### MEMORY (your personal notes) [${Math.min(100, pct)}% \u2014 ${content.length.toLocaleString()}/2,200 chars]\n${content}`,
    });
  }

  // 3. User profile entries
  if (userEntries.length > 0) {
    const content = userEntries.map(e => e.content).join("\n\u00a7\n");
    const pct = Math.round((content.length / 1375) * 100);
    contextMessages.push({
      role: "user",
      content: `### USER PROFILE (who the user is) [${Math.min(100, pct)}% \u2014 ${content.length.toLocaleString()}/1,375 chars]\n${content}`,
    });
  }

  // 4. My list
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

  // 5. Tasks (filter out archived session tasks)
  const trackedIds = new Set(
    sessions.filter((s) => s.inDashboard).map((s) => s.julesSessionId),
  );
  const visibleTasks = tasks.filter((t: TaskDoc) => {
    if (!t.key.startsWith("session:")) return true; // global tasks always visible
    const parts = t.key.split(":");
    if (parts.length < 2) return true;
    return trackedIds.has(parts[1]!);
  });

  if (visibleTasks.length > 0) {
    const formattedTasks = visibleTasks
      .map((t) => `[KEY: ${t.key}]\n${t.content}`)
      .join("\n\n---\n\n");
    contextMessages.push({
      role: "user",
      content: `### CURRENT PROJECT todo/task LISTS\n\n${formattedTasks}\n\nUse the update_task_list tool to maintain these lists. This is your project's persistent memory and source of truth for goals and progress.`,
    });
  }

  // 5b. Prompt main agent to create task lists for tracked sessions without them
  const sessionTaskKeys = new Set(
    tasks
      .filter((t: TaskDoc) => t.key.startsWith("session:"))
      .map((t: TaskDoc) => {
        const parts = t.key.split(":");
        return parts.length >= 2 ? parts[1]! : "";
      })
      .filter(Boolean),
  );
  const sessionsWithoutTasks = dashboardSessions.filter(
    (s) => !sessionTaskKeys.has(s.julesSessionId),
  );
  if (sessionsWithoutTasks.length > 0) {
    const lines = sessionsWithoutTasks
      .map(
        (s) =>
          `- ${s.shortName || s.julesSessionId.slice(0, 8)}: Use update_task_list(key: "session:${s.julesSessionId}:tasks", content: "...") to create a plan.`,
      )
      .join("\n");
    contextMessages.push({
      role: "user",
      content: `### SESSIONS WITHOUT TASK LISTS\n${lines}`,
    });
  }

  // 6. Inbox (unregistered files only)
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

  // 7. Memory nudge
  if ((nudgeCount ?? 0) >= 10) {
    await ctx.runMutation(internal.memory.db.resetNudgeCounter, { telegramChatId });
    contextMessages.push({
      role: "user",
      content: `[System: Review the conversation so far. Have you learned anything worth saving? Use the memory tool to add/update entries. Focus on: user preferences, corrections, environment facts, project conventions, decisions made. Skip: task progress, session outcomes, temporary state.]`,
    });
  } else {
    // Increment counter (fire-and-forget)
    ctx.runMutation(internal.memory.db.incrementNudgeCounter, { telegramChatId });
  }

  // 8. Pre-call notifications for slow tools
  contextMessages.push({
    role: "user",
    content: `### SLOW TOOLS
Before calling these, send a brief message_user notification:
- research \u2192 "Searching..."
- vfs send \u2192 "Sending..."
- query_sessions \u2192 "Checking..."
Pattern: notify \u2192 call tool \u2192 respond naturally.

You MUST use the message_user tool for EVERY SINGLE RESPONSE. Direct output is captured as internal notes, not shown to the user. If you don't use message_user, the user won't see your response.
`,
  });
  }

  // Combine: search results + recent messages + context
  const finalMessages = [...search, ...recent, ...contextMessages];

  // LOG CONTEXT SNAPSHOT (using standardized AI keys for Axiom)
  logger.context(`Context Built for thread ${threadId}`, undefined, {
    threadId,
    userId: telegramChatId,
    "ai.prompt": finalMessages,
    // Note: Model is passed at generation time, so we log it then if available
  });

  return finalMessages;
};

export const julesAgent = new Agent(components.agent, {
  name: "Jules Dispatch",
  languageModel: (() => {
    throw new Error("Model must be passed explicitly via generateText options");
  }) as any,
  instructions: systemInstructions,
  contextHandler: unifiedContextHandler,
  maxSteps: 50,
  contextOptions: {
    recentMessages: 50,
    searchOptions: {
      limit: 5,
      textSearch: true,
      vectorSearch: false,
      messageRange: { before: 1, after: 1 },
    },
    searchOtherThreads: true,
    excludeToolMessages: false,
  },
  tools: {
    create_session: tools.create_session,
    message_jules: tools.message_jules,
    approve_plan: tools.approve_plan,
    manage_sessions: tools.manage_sessions,
    update_task_list: tools.update_task_list,
    delete_task_list: tools.delete_task_list,
    vfs: tools.vfs,
    research: tools.research,
    execute_code: tools.execute_code,
    message_user: tools.message_user,
    query_sessions: tools.query_sessions,
    memory: tools.memory,
    provision_bot: tools.provision_bot,
  },
});

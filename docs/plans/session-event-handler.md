# Phase 1: Session Event Handler Agent

## Context

Jules Dispatch manages multiple Jules coding sessions via a single main agent thread per user. The main agent handles everything: user conversation, session management, polling notifications, and orchestration. This creates a bottleneck — polling wakes the main agent for every session state change, flooding its context with operational noise.

This plan introduces ephemeral per-session handler agents that process events independently and report back to the main orchestrator. The main agent stays focused on user interaction while session agents handle the mechanical work of monitoring, decision-making, and reporting.

## Findings

### Codebase

- **Single main agent per user** — `convex/agent/instance.ts` defines `julesAgent` with all tools. One thread per user.
- **Polling wakes main agent** — `convex/polling/actions.ts` runs every 30s, accumulates activities per thread, calls `julesAgent.generateText` on the main thread with `[ACTIVITY UPDATE]` messages.
- **`modelCache` is unnecessary** — `resolveLanguageModel` reads provider config from DB (not a network call). No latency benefit to caching.
- **Ephemeral sub-agent precedent** — `sessionManagerAgent.ts` already uses the create → use → delete thread pattern. Session handler follows the same lifecycle.
- **`pendingMessageText` is the existing wake queue** — `users.db.appendPendingMessage` concatenates messages on the user row. `processMessageQueue` drains them. Session reports slot into this system.
- **`lastProcessedActivityTime` is the activity watermark** — polling filters activities newer than this timestamp per session. `progressUpdated` events update this watermark but don't trigger agent wake in the current design.
- **File extraction is separate from activity tracking** — `processOutputs` extracts files from git patches and saves to `sessionOutputs` table. Session agents don't need to re-extract; they get file paths from stored activities.
- **Task lists are keyed per thread** — `tasks` table uses `threadId + key` index. Session agents writing to the main thread's task store with scoped keys (`session:{id}:tasks`) lets the main agent see all session plans natively.

### @convex-dev/agent Framework

- **No native thread forking** — but `fetchContextMessages` can pull messages from any thread with pagination and `excludeToolMessages: true`.
- **`messages` argument in `generateText`** — prepended to context before the prompt. Not saved to thread by default. Clean way to inject main thread context.
- **Context order: system prompt → contextOptions → messages arg → prompt arg** — main thread messages go in the messages arg, event context is the prompt.
- **Tools receive `ToolCtx` with `runMutation`, `runAction`, `runQuery`** — session handler tools can call internal mutations directly.
- **`ctx.scheduler.runAfter` available in actions** — used by `reportToOrchestrator` to schedule `wakeMainAgent`.

### Project Quirks

- **Polling uses `"use node"`** — the action runs in Node.js runtime for Jules SDK compatibility. Session handler actions should NOT need Node runtime (no Jules SDK calls — they use `message_jules` tool which calls internal actions).
- **`appendPendingMessage` concatenates with newlines** — multiple session reports in one cycle get concatenated. Main agent processes them together.
- **`processMessageQueue` is the standard wake path** — it checks `isAgentRunning`, resolves model, saves message, calls `generateText`. Session handler's `wakeMainAgent` delegates to this existing function.
- **Activities originator filter** — polling currently includes `planApproved` from user originator but filters other user activities. This stays unchanged.
- **Session state tracked on `julesSessions.lastKnownState`** — used for dashboard display, not for wake logic. The polling compares API state vs stored state.

## Decisions

| Decision | Choice |
|----------|--------|
| Thread type | Ephemeral (create → delete in finally block) |
| Activity storage | New `sessionActivities` table, stored forever |
| Activity format | Raw — type, summary, filesChanged (paths only), no content/patch |
| ProgressUpdated trigger | No — stored for context only |
| Other events trigger | Yes — agentMessaged, planGenerated, completed, failed |
| Task lists | Per-session on main thread, key `session:{id}:tasks` |
| Task list creation | Main agent creates, prompted by context handler |
| Task list cleanup | Lazy filter in context handler (skip archived sessions) |
| Report channel | `pendingMessageText` + `wakeMainAgent` (existing infra) |
| Report storage | None — reports are ephemeral via pending messages |
| Session agent tools | `message_jules`, `approve_plan`, `update_task_list`, `report_to_orchestrator` |
| Session agent voice | None — neutral, task-focused |
| Session agent decisions | Basic autonomy guided by task list and conversation context |
| Context injection | Last 25 main thread messages (excludeToolMessages) + all stored activities |
| Model resolution | Fresh per handler — no cache |
| Fallback | None — all-in on session agents |

## Implementation

### New Files

#### 1. `convex/sessions/activityStorage.ts`

Store and retrieve activities for session agents.

```typescript
export const storeActivity = internalMutation({
  args: {
    julesSessionId: v.string(),
    type: v.string(),
    createTime: v.number(),
    summary: v.string(),
    filesChanged: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("sessionActivities", args);
  },
});

export const getActivitiesForSession = internalQuery({
  args: { julesSessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessionActivities")
      .withIndex("by_session", (q) => q.eq("julesSessionId", args.julesSessionId))
      .order("asc")
      .collect();
  },
});
```

#### 2. `convex/tools/reportToOrchestrator.ts`

Minimal tool — appends report to pending messages and schedules wake.

```typescript
export function createReportToOrchestratorTool(
  mainThreadId: string,
  sessionInfo: { julesSessionId: string; shortName?: string },
) {
  return createTool({
    description: "Report to the orchestrator. REQUIRED before finishing. Your ONLY output channel.",
    inputSchema: z.object({
      report: z.string().describe("What happened, what you did, what the orchestrator should know."),
    }),
    execute: async (ctx, args) => {
      const shortName = sessionInfo.shortName || sessionInfo.julesSessionId.slice(0, 8);

      await ctx.runMutation(internal.users.db.appendPendingMessage, {
        threadId: mainThreadId,
        text: `[SESSION REPORT: ${shortName}]\n${args.report}`,
      });

      await ctx.scheduler.runAfter(0, internal.tools.reportToOrchestrator.wakeMainAgent, {
        mainThreadId,
      });

      return "Report sent to orchestrator.";
    },
  });
}

export const wakeMainAgent = internalAction({
  args: { mainThreadId: v.string() },
  handler: async (ctx, args) => {
    const isRunning = await ctx.runQuery(
      internal.users.db.isAgentRunning,
      { threadId: args.mainThreadId },
    );
    if (!isRunning) {
      const chatId = await ctx.runQuery(
        internal.users.db.getChatIdForThread,
        { threadId: args.mainThreadId },
      );
      if (chatId) {
        await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
          threadId: args.mainThreadId,
          telegramChatId: chatId,
        });
      }
    }
  },
});
```

#### 3. `convex/sessions/sessionEventHandlerAgent.ts`

Agent definition, spawn function, context formatter, scoped tools.

**Agent instructions:**

```
You handle events for one Jules coding session. You report to an orchestrator agent.

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
- report_to_orchestrator: REQUIRED. Report what happened and what you did.
```

**Spawn function:**

```typescript
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
    languageModel: any;
  },
): Promise<void>
```

**Context injection:**

```typescript
// 1. Last 25 messages from main thread
const mainMessages = await agent.fetchContextMessages(ctx, {
  threadId: mainThreadId,
  contextOptions: { recentMessages: 25, excludeToolMessages: true },
});
const mainContext = mainMessages
  .filter(m => m.message && (m.message.role === "user" || m.message.role === "assistant"))
  .map(m => ({ role: m.message.role, content: m.message.content }));

// 2. Event context message (session info + ALL activities + triggering events + task list)
const eventMessage = { role: "user", content: formatEventContext(...) };

// 3. Generate — framework order: system prompt → messages arg → prompt arg
const model = await resolveLanguageModel(ctx, mainThreadId);
const thread = await agent.createThread(ctx, {
  title: `Event: ${shortName} - ${currentState}`,
});

try {
  await agent.generateText(
    ctx,
    { threadId: thread.threadId },
    { messages: [...mainContext, eventMessage], prompt: "Handle this session event." },
  );
} finally {
  await agent.deleteThreadAsync(ctx, { threadId: thread.threadId });
}
```

**Event context format:**

```
## SESSION
ID: {julesSessionId}
Title: {shortName}
Repo: {repo}
State: {previousState} → {currentState}

## ALL ACTIVITIES (chronological, newest last)
[{createTime}] progressUpdated: Implementing auth middleware
  Files: src/auth/middleware.ts, src/auth/types.ts
[{createTime}] progressUpdated: Adding JWT validation
  Files: src/auth/jwt.ts
[{createTime}] planGenerated: Plan "Add auth system"
  Steps:
  1. Create middleware
  2. Add JWT validation
  3. Write tests
[{createTime}] agentMessaged: I've finished the middleware implementation

## NEW ACTIVITIES (this wake)
[{createTime}] agentMessaged: I've finished the middleware implementation

## TASK LIST
[KEY: session:{id}:tasks]
- [ ] Create auth middleware
- [ ] Add JWT validation
- [ ] Write tests
```

**Scoped tools (via closure, same pattern as sessionManagerAgent.ts):**

```typescript
const scopedReportToOrchestrator = createReportToOrchestratorTool(mainThreadId, sessionInfo);
const scopedUpdateTaskList = createScopedUpdateTaskTool(mainThreadId, julesSessionId);

const agent = new Agent(components.agent, {
  name: `Session Handler: ${shortName}`,
  languageModel: args.languageModel,
  instructions: sessionHandlerInstructions,
  maxSteps: 15,
  tools: {
    message_jules,
    approve_plan,
    report_to_orchestrator: scopedReportToOrchestrator,
    update_task_list: scopedUpdateTaskList,
  },
});
```

### Modified Files

#### 1. `convex/schema.ts`

Add `sessionActivities` table:

```typescript
sessionActivities: defineTable({
  julesSessionId: v.string(),
  type: v.string(),
  createTime: v.number(),
  summary: v.string(),
  filesChanged: v.optional(v.array(v.string())),
})
  .index("by_session", ["julesSessionId"])
  .index("by_session_and_time", ["julesSessionId", "createTime"]),
```

#### 2. `convex/tools/index.ts`

Add export:

```typescript
export { createReportToOrchestratorTool } from "./reportToOrchestrator";
```

#### 3. `convex/polling/actions.ts`

**Remove:**
- `modelCache` declaration and pre-resolution loop (lines 30-38)
- `pollMessages` and `needsWake` accumulation (lines 40-42)
- Entire main agent wake loop (lines 147-194)
- Import of `julesAgent` (line 4)

**In per-session loop — store all activities, separate triggers:**

```typescript
const triggeringActivities: any[] = [];

for (const act of newActivities) {
  const actTime = new Date(act.createTime).getTime();
  if (actTime > maxTime) maxTime = actTime;

  // Store ALL activities (including progressUpdated)
  const filesChanged = act.type === 'progressUpdated' && act.artifacts
    ? extractFilePaths(act.artifacts)
    : undefined;

  await ctx.runMutation(internal.sessions.activityStorage.storeActivity, {
    julesSessionId: sessionDoc.julesSessionId,
    type: act.type,
    createTime: actTime,
    summary: summarizeActivity(act),
    filesChanged,
  });

  // Only non-progress events trigger the agent
  if (act.type !== 'progressUpdated') {
    triggeringActivities.push(act);
  }

  // Existing output processing
  if (act.type === 'progressUpdated' && act.artifacts?.length > 0) {
    await processOutputs(ctx, sessionDoc.julesSessionId, act.artifacts, true, act.id);
  } else if (act.type === 'sessionCompleted') {
    // existing output fetch + process logic (unchanged)
  }
}

// Store event for handler spawning
if (triggeringActivities.length > 0) {
  sessionEvents.set(sessionDoc.julesSessionId, {
    triggeringActivities,
    currentState,
  });
}
```

**Replace wake loop with handler spawning:**

```typescript
for (const sessionDoc of sessions) {
  const event = sessionEvents.get(sessionDoc.julesSessionId);
  if (!event) continue;

  // Fetch ALL stored activities for this session
  const allActivities = await ctx.runQuery(
    internal.sessions.activityStorage.getActivitiesForSession,
    { julesSessionId: sessionDoc.julesSessionId },
  );

  // Fetch tasks from main thread
  const tasks = await ctx.runQuery(internal.tasks.listTasksForThread, {
    threadId: sessionDoc.threadId,
  });

  // Resolve model fresh
  const model = await resolveLanguageModel(ctx, sessionDoc.threadId).catch(() => null);
  if (!model) {
    console.error(`[pollJulesActivities] Model resolution failed for thread ${sessionDoc.threadId}`);
    continue;
  }

  await ctx.runAction(internal.sessions.sessionEventHandlerAgent.spawnHandler, {
    mainThreadId: sessionDoc.threadId,
    julesSessionId: sessionDoc.julesSessionId,
    shortName: sessionDoc.shortName || sessionDoc.julesSessionId.slice(0, 8),
    repo: sessionDoc.repo,
    currentState: event.currentState,
    previousState: sessionDoc.lastKnownState,
    triggeringActivities: event.triggeringActivities,
    allActivities,
    tasks,
    languageModel: model,
  });
}
```

**Add helper functions:**

```typescript
function summarizeActivity(act: any): string {
  if (act.type === 'agentMessaged') return act.message || '';
  if (act.type === 'planGenerated') {
    const plan = act.plan;
    let text = `Plan: "${plan?.title || 'Untitled'}"`;
    plan?.steps?.forEach((s: any) => { text += `\n  ${s.index}. ${s.title}`; });
    return text;
  }
  if (act.type === 'sessionCompleted') return 'Session completed.';
  if (act.type === 'sessionFailed') return 'Session failed.';
  if (act.type === 'planApproved') return 'Plan approved.';
  if (act.type === 'progressUpdated') return act.title || act.description || 'progress update';
  return `${act.type}: ${act.title || act.description || ''}`;
}

function extractFilePaths(artifacts: any[]): string[] {
  const paths: string[] = [];
  for (const art of artifacts) {
    if (art.changeSet?.gitPatch?.unidiffPatch) {
      const fileBlocks = art.changeSet.gitPatch.unidiffPatch.split(/(?=^diff --git)/m);
      for (const block of fileBlocks) {
        const match = block.match(/^\+\+\+ b\/(.+)$/m);
        if (match) paths.push(match[1]);
      }
    }
  }
  return paths;
}
```

#### 4. `convex/agent/instance.ts`

**a) Filter archived session tasks from context:**

```typescript
// In unifiedContextHandler, after fetching tasks:
const trackedIds = new Set(
  sessions.filter(s => s.inDashboard).map(s => s.julesSessionId)
);
const visibleTasks = tasks.filter(t => {
  if (!t.key.startsWith('session:')) return true; // global tasks always visible
  const sessionId = t.key.split(':')[1];
  return trackedIds.has(sessionId);
});
// Use visibleTasks instead of tasks in the context section
```

**b) Prompt main agent to create task lists for sessions without them:**

```typescript
const sessionTaskKeys = new Set(
  tasks.filter(t => t.key.startsWith('session:')).map(t => t.key.split(':')[1])
);
const sessionsWithoutTasks = dashboardSessions.filter(
  s => !sessionTaskKeys.has(s.julesSessionId)
);
if (sessionsWithoutTasks.length > 0) {
  const lines = sessionsWithoutTasks.map(s =>
    `- ${s.shortName || s.julesSessionId.slice(0, 8)}: ` +
    `Use update_task_list(key: "session:${s.julesSessionId}:tasks", content: "...") to create a plan.`
  ).join('\n');
  contextMessages.push({
    role: "user",
    content: `### SESSIONS WITHOUT TASK LISTS\n${lines}`,
  });
}
```

## File Manifest

| File | Action | Est. Lines |
|------|--------|------------|
| `convex/schema.ts` | Modify | +10 |
| `convex/sessions/sessionEventHandlerAgent.ts` | Create | ~200 |
| `convex/sessions/activityStorage.ts` | Create | ~30 |
| `convex/tools/reportToOrchestrator.ts` | Create | ~55 |
| `convex/tools/index.ts` | Modify | +1 |
| `convex/polling/actions.ts` | Modify | ~80 changed |
| `convex/agent/instance.ts` | Modify | +20 |

## Flow

```
Main agent creates session "abc", writes task list:
  update_task_list(key: "session:abc:tasks", content: "1. Add middleware\n2. Write tests\n3. Review")

Cron (30s)
  → pollJulesActivities
  → Session "abc" has 3 new activities:
      - progressUpdated (middleware done, files: src/auth/middleware.ts, src/auth/types.ts)
      - progressUpdated (tests started, files: src/auth/jwt.test.ts)
      - agentMessaged ("middleware and tests done, ready for review")
  → Store all 3 in sessionActivities table
  → Process outputs for progressUpdated (silent, existing file extraction)
  → agentMessaged triggers handler spawn (non-progress event)

Handler receives:
  → Last 25 main thread msgs (user said "refactor auth to use JWT")
  → ALL stored activities (including the 2 progressUpdates with file paths)
  → Task list: "1. Add middleware\n2. Write tests\n3. Review"

Handler acts:
  → Observes: middleware done (from progressUpdated), tests in progress, Jules says ready
  → Updates task list: "1. Add middleware [done]\n2. Write tests [in progress]\n3. Review"
  → Calls report_to_orchestrator: "Middleware done, tests in progress, Jules says ready for review"

Report delivery:
  → Appends "[SESSION REPORT: auth-refactor] ..." to pendingMessageText
  → Schedules wakeMainAgent
  → Main agent wakes via processMessageQueue

Main agent:
  → Sees "[SESSION REPORT: auth-refactor]" in context
  → Tells user: "Your auth session — middleware done, tests almost done, Jules says ready for review"
```

## Testing

1. Activity storage — new activities appear in `sessionActivities` after poll
2. ProgressUpdated silent — stored but doesn't spawn handler
3. Handler spawn — non-progress events spawn session handler
4. Context injection — handler receives last 25 main thread messages + all stored activities
5. Task list visibility — handler sees session task list in context
6. Task list recitation — handler updates task list before reporting
7. Report delivery — report appends to pendingMessageText, main agent wakes
8. Main agent relay — main agent sees report, relays to user
9. Multiple sessions — each session with events gets its own handler
10. Ephemeral cleanup — no orphaned threads
11. Task filtering — archived session tasks hidden from main agent context
12. Missing task lists — main agent prompted to create task lists

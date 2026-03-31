# Session Discovery & API Optimization Plan

## Context

Jules Dispatch uses the Jules SDK to manage coding sessions. The current implementation has several inefficiencies:

- Background polling discovers ALL sessions on startup, causing 100+ API calls
- `getAllSessionsWithInfo` is called 3 times per `query_sessions` invocation
- N+1 query patterns for PR metadata and bulk updates
- Context handler makes 3 overlapping DB queries per agent turn
- `session.info()` called per tracked session in polling (always hits network since Convex actions are stateless)
- Source/repo field is incorrectly extracted (`js.source?.github` instead of `owner/repo`)

**Key insight:** The Jules SDK's `SessionResource` from `sessions().all()` contains the same fields as `session.info()` — state, title, source, createTime, outputs. We don't need per-session `info()` calls.

---

## Architecture Changes

### Discovery Model
- **Before:** Background cron auto-discovers sessions from Jules API
- **After:** On-demand discovery via `query_sessions` only. User-initiated.

### Session Manager Context
- **Before:** Injects tracked + active untracked + unregistered count + archived count
- **After:** Injects tracked + active untracked only. Unregistered count removed from context (discovery is on-demand).

### Data Flow
```
query_sessions → getAllSessionsWithInfo (1 Jules API call) → sessions[]
  → spawnSessionManagerAgent(sessions, prompt)
    → local_list_sessions uses sessions[] (no re-fetch)
    → local_manage_sessions uses sessions[] (no re-fetch)
    → local_inspect_session uses sessions[] for metadata + activities.list() for log
```

---

## Implementation Steps

### Step 1: Add `repo` field to `julesSessions` schema

**File:** `convex/schema.ts`

Add `repo: v.optional(v.string())` to the `julesSessions` table.

**File:** `convex/types/index.ts`

Add `repo?: string` to `JulesSessionDoc` interface.

**Error handling:**
- If repo extraction fails (malformed source), set to `"repoless"` — never throw

---

### Step 2: Fix source/repo extraction in `getAllSessionsWithInfo`

**File:** `convex/sessions/sessionManager.ts`

Replace:
```typescript
repo: js.source?.github,
```

With:
```typescript
repo: js.source?.githubRepo
  ? `${js.source.githubRepo.owner}/${js.source.githubRepo.repo}`
  : "repoless",
```

This applies to both `getAllSessionsWithInfo` and `getSessionDetails`.

**Error handling:**
- Access `githubRepo` with optional chaining at each level
- Default to `"repoless"` for repoless sessions or malformed source objects

---

### Step 3: Remove auto-discovery from `getAllSessionsWithInfo`

**File:** `convex/sessions/sessionManager.ts`

Remove the auto-discovery loop (lines 81-102) that calls `upsertDiscoveredSession` for sessions not in DB.

The function becomes a pure read: fetch Jules API + DB, merge, return. No side effects.

**Error handling:**
- If Jules API fails, return `{ success: false, error: "..." }` instead of crashing
- If DB query fails, return `{ success: false, error: "..." }`
- Catch and log both independently — if Jules API fails but DB succeeds, return DB-only data with a warning

---

### Step 4: Batch PR metadata query (eliminate N+1)

**File:** `convex/sessions/sessionManager.ts`

Replace the per-session `getSessionOutputs` call inside `Promise.all` with:

1. Collect all session IDs: `const sessionIds = julesSessions.map(js => js.id)`
2. Single bulk query: create `getBulkSessionOutputs` that returns `Map<julesSessionId, SessionOutputDoc[]>`
3. Map outputs to sessions in memory

**New function in `convex/sessions/db.ts`:**
```typescript
export const getBulkSessionOutputs = internalQuery({
  args: { julesSessionIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const outputs = await ctx.db
      .query("sessionOutputs")
      .collect(); // or filter by IDs if index exists
    // Group by julesSessionId
    const map = new Map<string, SessionOutputDoc[]>();
    for (const o of outputs) {
      if (args.julesSessionIds.includes(o.julesSessionId)) {
        const arr = map.get(o.julesSessionId) || [];
        arr.push(o);
        map.set(o.julesSessionId, arr);
      }
    }
    return map;
  },
});
```

**Error handling:**
- If bulk query fails, return empty map (graceful degradation — fuzzy search just won't have PR metadata)
- Log warning but don't fail the entire session list

---

### Step 5: Split into lightweight and full session queries

**File:** `convex/sessions/sessionManager.ts`

Create `getAllSessionsBasic` — same as `getAllSessionsWithInfo` but WITHOUT the PR metadata query. Used by `manage_sessions` which doesn't need fuzzy search data.

Keep `getAllSessionsWithInfo` for `query_sessions` / `list_sessions` which need full metadata.

**Error handling:**
- Both functions return `{ success: true/false, sessions: [], error? }`
- On Jules API failure, fall back to DB-only data with `{ success: true, sessions: dbOnly, warning: "Jules API unavailable" }`

---

### Step 6: Pass pre-fetched sessions to session manager tools

**File:** `convex/sessions/sessionManagerAgent.ts`

Modify `spawnSessionManagerAgent` to pass the `sessions` array into the local tool closures:

```typescript
const local_list_sessions = createTool({
  // ...
  execute: async (subCtx, args) => {
    // Use pre-fetched sessions instead of calling getAllSessionsWithInfo
    let filtered = sessions;
    // Apply since/state/topic filters on the passed array
    // ...
  },
});

const local_manage_sessions = createTool({
  // ...
  execute: async (subCtx, args) => {
    // Use pre-fetched sessions instead of calling getAllSessionsWithInfo
    // ...
  },
});
```

**Error handling:**
- If `sessions` array is empty, return `"No sessions available. Try refreshing."` instead of crashing
- Add an optional `refresh` flag to `list_sessions` that triggers a fresh `getAllSessionsWithInfo` call if the user explicitly asks for it

---

### Step 7: Fix `getSessionDetails` — accept sessions from parent

**File:** `convex/sessions/sessionManager.ts`

`getSessionDetails` currently fetches ALL sessions just to find one. Rewrite it:

- Accept optional `sessions` array parameter
- If sessions provided, find matching session from array (no Jules API call)
- If not provided, fetch single session via `jules.session(id).info()` (not `sessions().all()`)
- Always call `fetchSessionActivities` for the activity log (this is the tool's main purpose)

**File:** `convex/sessions/sessionManagerAgent.ts`

Update `local_inspect_session` to pass the pre-fetched sessions:

```typescript
const local_inspect_session = createTool({
  execute: async (subCtx, args) => {
    const result = await subCtx.runAction(
      internal.sessions.sessionManager.getSessionDetails,
      { sessionIds: [args.julesSessionId], threadId: originalThreadId, sessions: [/* find from pre-fetched */] },
    );
    // ...
  },
});
```

**Error handling:**
- If session not found in pre-fetched array AND Jules API fails, return `"Session not found or Jules API unavailable"`
- If activities fetch fails, return metadata without activity log: `"Session: X | State: Y | (activity log unavailable)"`
- Parallelize activity fetch with `Promise.all` if multiple IDs requested

---

### Step 8: Polling — single `sessions().all()` instead of per-session `info()`

**File:** `convex/polling/actions.ts`

Replace the per-session `session.info()` loop:

1. Call `jules.sessions({}).all()` once at the top
2. Build a map: `sessionId -> { state, outputs, title, createTime }`
3. For each tracked session, look up state from the map
4. Only call `session.activities.list({ filter: create_time>"..." })` for activity fetching

```typescript
const allSessions = await jules.sessions({}).all();
const sessionMap = new Map(allSessions.map(s => [s.id, s]));

for (const sessionDoc of sessions) {
  const julesSession = sessionMap.get(sessionDoc.julesSessionId);
  if (!julesSession) continue; // Session deleted on Jules side
  
  const currentState = julesSession.state;
  // ... rest of polling logic
}
```

For activities, use the Jules API filter:
```typescript
const cutoffTime = new Date(sessionDoc.lastProcessedActivityTime).toISOString();
const { activities } = await session.activities.list({
  filter: `create_time>"${cutoffTime}"`,
});
```

**Error handling:**
- If `sessions().all()` fails, fall back to per-session `session.info()` with a warning log
- If `activities.list()` fails for a session, log error and continue to next session (don't crash the whole poll)
- If a tracked session is not found in `sessions().all()` (deleted on Jules side), mark it as inactive in DB and log warning
- Wrap each session's processing in try/catch so one failure doesn't stop the rest

---

### Step 9: Context handler — single DB query

**File:** `convex/agent/instance.ts`

Replace the three queries (`getDashboardSessions`, `getActiveSessions`, `getUnacknowledgedSessions`) with a single `getAllSessions` query and client-side filtering:

```typescript
const allSessions = await ctx.runQuery(internal.sessions.db.getAllSessions, {});
const dashboardSessions = allSessions.filter(s => s.inDashboard);
const activeUntracked = allSessions.filter(s => !s.inDashboard && s.acknowledged && s.state !== "completed" && s.state !== "failed");
```

Remove the unregistered sessions section from context entirely (discovery is on-demand now).

**Error handling:**
- If `getAllSessions` fails, return `allMessages` unchanged (no context injection)
- Log error but don't crash the agent turn

---

### Step 10: Add `getProviderConfigByThreadId`

**File:** `convex/users/db.ts`

Add a new query that resolves threadId → telegramChatId → providerConfig in one query:

```typescript
export const getProviderConfigByThreadId = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
      .unique();
    if (!user) return null;
    return {
      telegramChatId: user.telegramChatId,
      providerConfig: user.providerConfig,
      julesApiKey: user.julesApiKey,
      exaApiKey: user.exaApiKey,
    };
  },
});
```

Update `getJulesClient` in `nodeActions.ts` to use this instead of the two-query chain.

**Error handling:**
- If user not found, throw clear error: `"No user found for thread. Re-run setup."`
- If Jules API key not configured, throw: `"Jules API key not configured. Use /connect to set it up."`

---

### Step 11: Fix `bulkUpdateSessions` — single query

**File:** `convex/sessions/db.ts`

Replace the N+1 query+patch loop:

```typescript
export const bulkUpdateSessions = internalMutation({
  args: {
    julesSessionIds: v.array(v.string()),
    updates: v.object({
      acknowledged: v.optional(v.boolean()),
      inDashboard: v.optional(v.boolean()),
      prefs: v.optional(v.object({
        approval: v.optional(v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict"))),
        verbosity: v.optional(v.union(v.literal("silent"), v.literal("milestones"), v.literal("full"))),
      })),
      repo: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    // Single query to fetch all matching sessions
    const allSessions = await ctx.db.query("julesSessions").collect();
    const matching = allSessions.filter(s => args.julesSessionIds.includes(s.julesSessionId));
    
    let updated = 0;
    for (const session of matching) {
      await ctx.db.patch(session._id, args.updates);
      updated++;
    }
    return { updated };
  },
});
```

**Error handling:**
- If no sessions match, return `{ updated: 0 }` (not an error)
- If patch fails for one session, log and continue to next
- Return count of successfully updated sessions

---

### Step 12: Polling — resolve language model once, combine state updates

**File:** `convex/polling/actions.ts`

- Resolve language model once at the top of the loop (or cache per threadId)
- Combine the two `updateSessionState` calls into one: collect all fields (`lastKnownState`, `isActive`, `lastProcessedActivityTime`) and patch once

**Error handling:**
- If language model resolution fails, use fallback model with warning log
- If state update fails, log error but continue (state will be corrected on next poll)

---

### Step 13: Update system instructions

**File:** `convex/agent/instructions.ts`

Update the Sessions section:
- Remove references to background discovery
- Add guidance for on-demand discovery flow
- Add first-run recommendation: "If user has zero tracked sessions, suggest `query_sessions` to check for existing Jules sessions"
- Clarify ARCHIVE = untrack (remove from dashboard), only works on tracked sessions
- Clarify REGISTER = acknowledge unregistered sessions

**Error handling:**
- Instructions should tell the agent to handle tool failures gracefully: "If a tool returns an error, inform the user what went wrong and suggest alternatives"

---

### Step 14: Update `query_sessions` tool description

**File:** `convex/tools/index.ts`

Update the prompt guidance in the description to help the LLM construct better prompts:

```
prompt: What the user wants to do — e.g. "find active sessions from today", 
  "show failed sessions from last week", "track all sessions about auth",
  "register all unregistered sessions".
  If omitted, defaults to "Show me my sessions and let me know if any need attention."
```

---

### Step 15: Write `JULES_SDK.md`

Document:
- Which SDK methods hit the network vs cache
- `SessionResource` structure and field meanings
- Activity filtering via `filter: create_time>"..."`
- Caching behavior (in-memory, useless in Convex stateless actions)
- Our usage conventions and gotchas
- Error types the SDK throws and how we handle them

---

## Network Call Summary (Before vs After)

| Flow | Before | After |
|------|--------|-------|
| `query_sessions` | 3 Jules API calls + N+1 DB queries | 1 Jules API call + 1 bulk DB query |
| Polling (N sessions) | 3N Jules API calls + 4N DB queries | N+1 Jules API calls + 2N DB queries |
| Context handler (per turn) | 3 DB queries | 1 DB query |
| `getSessionDetails` (1 session) | 1 Jules API call (ALL sessions) + 1 activity call | 0 Jules API calls (uses pre-fetched) + 1 activity call |
| `manage_sessions` | 1 Jules API call + N+1 DB queries | 0 Jules API calls (uses pre-fetched) + 1 bulk DB query |
| Agent turn (Jules API key) | 2 DB queries per session | 1 DB query per session |

---

## File Change Summary

| File | Changes |
|------|---------|
| `convex/schema.ts` | Add `repo` field to `julesSessions` |
| `convex/types/index.ts` | Add `repo` to `JulesSessionDoc`, add `createTimeMs` to `SessionInfo` |
| `convex/sessions/sessionManager.ts` | Remove auto-discovery, fix repo extraction, batch PR metadata, add `getAllSessionsBasic`, fix `getSessionDetails` |
| `convex/sessions/sessionManagerAgent.ts` | Pass sessions to local tools, update `local_inspect_session`, update instructions |
| `convex/sessions/db.ts` | Add `getBulkSessionOutputs`, fix `bulkUpdateSessions` |
| `convex/polling/actions.ts` | Single `sessions().all()`, filter activities by time, resolve model once, combine state updates |
| `convex/agent/instance.ts` | Single `getAllSessions` query, remove unregistered context |
| `convex/agent/instructions.ts` | Update sessions section, add first-run guidance |
| `convex/tools/index.ts` | Update `query_sessions` description, update `manage_sessions` to use lightweight query |
| `convex/tools/nodeActions.ts` | Add `getProviderConfigByThreadId`, update `getJulesClient` |
| `convex/users/db.ts` | Add `getProviderConfigByThreadId` query |
| `JULES_SDK.md` | New file — SDK documentation |

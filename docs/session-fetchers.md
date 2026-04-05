# Session Fetchers Documentation

## Overview

This document details all session fetching functions in the Jules Dispatch codebase, their SDK methods, and where they are used.

---

## Session Fetchers (7 Total)

### 1. `fetchAllJulesSessions()` - Base Fetcher

**Location:** `convex/sessions/sessionManager.ts:11-20`

**Jules SDK Method:** `jules.sessions({}).all()`

**Returns:** Raw `JulesApiSession[]` from API

**Data Fields from SDK:**
- `id`: Session ID
- `title`: Session title  
- `state`: Session state (QUEUED, PLANNING, IN_PROGRESS, etc.)
- `sourceContext.source`: Repository info
- `sourceContext.githubRepoContext.startingBranch`: Base branch
- `outputs`: Array of outputs (changeSet, pullRequest)
- `createTime`: ISO timestamp
- `updateTime`: ISO timestamp

**Called By:**
- `getAllSessionsBasic` (line 92)
- `getAllSessionsWithInfo` (line 167)
- `getSessionDetails` (line 306, fallback when no prefetch)

---

### 2. `fetchSessionActivities()` - Activity Fetcher

**Location:** `convex/sessions/sessionManager.ts:22-31`

**Jules SDK Methods:**
```typescript
const session = await jules.session(sessionId);
const { activities } = await session.activities.list({});
```

**Returns:** Formatted activity log string

**Data Fields from SDK (Activity):**
- `id`: Activity ID
- `type`: Activity type (progressUpdated, agentMessaged, planGenerated, planApproved, sessionCompleted, sessionFailed, userMessaged)
- `createTime`: ISO timestamp
- `originator`: Who triggered it (user/agent)
- `title`: Activity title
- `description`: Activity description
- `message`: Message content
- `plan`: Generated plan object
- `reason`: Failure reason
- `artifacts`: Array of artifacts (changeSet, pullRequest)

**Transformation:** `formatActivityLog()` function (lines 33-62) formats activities into human-readable string with timestamps.

**Called By:**
- `getSessionDetails` (line 342)

---

### 3. `getAllSessionsBasic()` - Basic Session Query

**Location:** `convex/sessions/sessionManager.ts:82-151`

**Jules SDK Method:** `jules.sessions({}).all()` (via `fetchAllJulesSessions`)

**Also Queries:** Local DB `getAllSessions` for metadata

**Returns:** `Promise<SessionQueryResult>` with merged `SessionInfo[]`

**Data Flow:**
1. Parallel fetch of Jules API sessions + local DB sessions
2. Merges fields:
   - `julesSessionId` from SDK
   - `title` from SDK (with DB fallback)
   - `state` from SDK (with DB fallback)
   - `repo` from DB or computed from SDK
   - `shortName`, `origin`, `acknowledged`, `inDashboard`, `prefs` from DB
3. Auto-registers new sessions in DB

**Called By:**
- `manage_sessions` tool (`convex/tools/index.ts:454`)

---

### 4. `getAllSessionsWithInfo()` - Enhanced Session Query with PR Metadata

**Location:** `convex/sessions/sessionManager.ts:157-248`

**Jules SDK Method:** `jules.sessions({}).all()` (via `fetchAllJulesSessions`)

**Also Queries:**
- Local DB `getAllSessions`
- Local DB `getBulkSessionOutputs` for PR metadata

**Returns:** `Promise<SessionQueryResult>` with `SessionInfo[]` including `prMetadata`

**Additional Data:**
```typescript
prMetadata: outputs
  .filter((o) => o.type === "pullRequest")
  .map((o) => ({
    title: o.title,
    description: o.description,
  }));
```

**Called By:**
- `query_sessions` tool (`convex/tools/index.ts:351`)

---

### 5. `getSessionDetails()` - Detailed Session Inspector

**Location:** `convex/sessions/sessionManager.ts:254-360`

**Jules SDK Methods:**
- `jules.sessions({}).all()` (conditional - only if no prefetch)
- `fetchSessionActivities()` for each session

**Special Feature:** Accepts optional `sessions` array parameter to avoid redundant API calls (prefetch support)

**Returns:** `Promise<SessionQueryResult>` with `SessionInfo[]` including formatted activity logs

**Logic:**
```typescript
// If prefetched sessions provided, use them
if (args.sessions && args.sessions.length > 0) {
  for (const s of args.sessions) {
    preFetchedMap.set(s.julesSessionId, s);
  }
} else {
  // Otherwise fetch fresh from API
  sessions = await fetchAllJulesSessions(ctx, args.threadId);
}
```

**Output Fields:**
- All `SessionInfo` fields
- `lastActivity`: Formatted activity log string

**Called By:**
- `local_inspect_session` tool in `sessionManagerAgent.ts:246`

---

### 6. `getSessionActivities()` - Standalone Activity Action

**Location:** `convex/sessions/actions.ts:125-183`

**Jules SDK Methods:**
```typescript
const session = await jules.session(args.sessionId);
const { activities: activitiesResult } = await session.activities.list({});
```

**Returns:** `{ success: true, activities: string } | { success: false, error: string }`

**Transformation:** Enhanced formatting with artifact extraction (lines 134-176)

**Called By:** No direct tool calls (utility available for future use)

---

### 7. `pollJulesActivities()` - Background Polling Loop

**Location:** `convex/polling/actions.ts:21-242`

**Jules SDK Methods:**
```typescript
// 1. Fetch all sessions (once per poll cycle)
const allSessions = await jules.sessions({}).all();

// 2. Per-session activity fetch (filtered by time)
const session = await jules.session(sessionDoc.julesSessionId);
const { activities } = await session.activities.list({
  filter: `create_time>"${cutoffTime}"`,
});

// 3. On completion - fetch full details
const fullSession = await sessionClient.info();
```

**Important Note:** On session completion, MUST call `session().info()` because `outputs` are empty in list responses:
```typescript
// IMPORTANT: session.outputs is empty in list responses.
// Must fetch full session details to get actual outputs.
const fullSession = await sessionClient.info();
finalOutputs = fullSession.outcome?.outputs || fullSession.outputs || [];
```

**Called By:** Convex cron job (background polling)

---

## SDK Method Usage Summary

| SDK Method | Used In | Purpose | Data Source |
|------------|---------|---------|-------------|
| `jules.sessions({}).all()` | `fetchAllJulesSessions`, `pollJulesActivities` | List all sessions | **Jules API** |
| `jules.session(id)` | Most fetchers | Get session handle | **Jules API** |
| `session.activities.list({})` | `fetchSessionActivities`, `getSessionActivities` | Get all activities | **Jules API** |
| `session.activities.list({ filter })` | `pollJulesActivities` | Get filtered activities | **Jules API** |
| `sessionClient.info()` | `pollJulesActivities` | Get full session with outputs | **Jules API** |
| `jules.session({ prompt, ... })` | `createSession` | Create new session | **Jules API** |
| `session.send(prompt)` | `sendMessage` | Send message | **Jules API** |
| `session.approve()` | `approvePlan` | Approve plan | **Jules API** |

---

## Call Hierarchy

```
User Tools (convex/tools/index.ts)
│
├── query_sessions ─────────────────┐
│                                   │
├── manage_sessions ────────────────┤
│                                   │
└── create_session ─────────────┐   │
                                │   │
                                ▼   ▼
Internal Actions (convex/sessions/)
│
├── sessionManager.ts             actions.ts
│   │
│   ├── fetchAllJulesSessions     ├── createSession
│   │   └── jules.sessions().all()
│   │
│   ├── fetchSessionActivities
│   │   ├── jules.session(id)
│   │   └── session.activities.list({})
│   │
│   ├── getAllSessionsBasic
│   │   ├── fetchAllJulesSessions
│   │   └── DB: getAllSessions
│   │
│   ├── getAllSessionsWithInfo
│   │   ├── fetchAllJulesSessions
│   │   ├── DB: getAllSessions
│   │   └── DB: getBulkSessionOutputs
│   │
│   └── getSessionDetails
│       ├── fetchAllJulesSessions (conditional)
│       ├── fetchSessionActivities (per session)
│       └── DB: getAllSessions
│
Polling (convex/polling/actions.ts)
│
└── pollJulesActivities
    ├── jules.sessions().all()
    ├── jules.session(id)
    ├── session.activities.list({ filter })
    └── sessionClient.info() [on completion]
```

---

## Cached vs Live Data

### Database Cache (Persistent)

**Table:** `julesSessions`

**Cached Fields:**
- `julesSessionId`: Jules API session ID
- `shortName`: User/agent assigned display name
- `lastKnownState`: Last known session state
- `lastProcessedActivityTime`: Watermark for activity polling
- `acknowledged`: Whether session is registered
- `inDashboard`: Whether in "My List"
- `prefs`: approval/verbosity settings
- `repo`: Associated repository
- `origin`: "agent" or "discovered"

### In-Memory Prefetch (Agent Context)

**Location:** Passed to `spawnSessionManagerAgent()` in `query_sessions` tool

**Usage:** Sub-agent tools receive prefetched `SessionInfo[]` array to avoid redundant API calls

**Risk:** Can become stale if session state changes during agent execution

---

## Areas Using Prefetched/Cached Data

1. **`sessionManagerAgent.ts` - `local_inspect_session` tool**
   - Receives prefetched `sessions` array
   - Passes to `getSessionDetails` action
   - **Risk:** May show stale session state

2. **`sessionManager.ts` - `getSessionDetails` action**
   - Checks for `args.sessions` parameter
   - Uses prefetched data if available instead of fetching from API
   - **Risk:** Activity logs may be outdated

---

## Recommendations

### For Live Data (Current Session State)

Use these fetchers (always hit API):
- `getAllSessionsBasic()` - for basic session list
- `getAllSessionsWithInfo()` - for sessions with PR metadata

### For Background Operations

The polling system (`pollJulesActivities`) already uses time-filtered queries and only fetches full session details on state changes.

### To Fix Stale Data Issues

See the fix applied to `sessionManagerAgent.ts` to make `inspect_session` fetch live data instead of using prefetched sessions.

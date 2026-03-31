# Jules SDK Documentation

## Overview

The Jules SDK (`@google/jules-sdk`) is the official TypeScript client for the Jules API (`https://jules.googleapis.com/v1alpha`). It provides abstractions for creating, managing, and monitoring AI coding sessions.

**Version:** 1.x (monorepo at `packages/core`)
**Entry point:** `import { jules } from '@google/jules-sdk'`

---

## Architecture

### Client Hierarchy

```
jules (JulesClient)
├── sessions(options) → SessionCursor (paginated list)
├── session(config) → SessionClient (create new)
├── session(id) → SessionClient (rehydrate existing)
├── run(config) → AutomatedSession (fire-and-forget)
├── sources() → SourceManager
├── select(query) → QueryResult[] (local graph queries)
├── sync(options) → SyncStats (reconciliation engine)
└── with(options) → JulesClient (immutable clone)
```

### Key Design Patterns

- **Write-through caching:** Fetched data is automatically persisted to in-memory storage
- **Async iterators:** Pagination is abstracted via `for await` loops
- **Discriminated unions:** Activities and artifacts use `type` field for type narrowing
- **Immutable client:** `jules.with()` returns a new client, original unchanged

---

## Core Types

### SessionResource

The raw REST API response for a session. This is what `sessions().all()` and `session.info()` return.

```typescript
interface SessionResource {
  name: string;           // "sessions/314159..."
  id: string;             // "314159..."
  prompt: string;         // Original task description
  title: string;          // Human-readable title
  state: SessionState;    // See states below
  createTime: string;     // RFC 3339 timestamp
  updateTime: string;     // RFC 3339 timestamp
  url: string;            // Jules web app URL
  source: Source;         // GitHub repo or undefined for repoless
  sourceContext: SourceContext;
  outputs: SessionOutput[]; // Final outputs (PRs, changeSets)
  activities?: Activity[];  // Only if include: { activities: true }
  generatedFiles?: GeneratedFile[];
  outcome: SessionOutcome;
}
```

**Source structure:**
```typescript
interface Source {
  name: string;  // "sources/github/owner/repo"
  id: string;    // "github/owner/repo"
  type: 'githubRepo';
  githubRepo: {
    owner: string;
    repo: string;
    isPrivate: boolean;
  };
}
```

**IMPORTANT:** `source` is NOT a string. There is no `source.github` property. The correct path is `source?.githubRepo?.owner + "/" + source?.githubRepo?.repo`. If `source` is undefined or `githubRepo` is missing, the session is **repoless**.

### SessionState

```typescript
type SessionState =
  | 'unspecified'
  | 'queued'
  | 'planning'
  | 'awaitingPlanApproval'  // Call session.approve() to continue
  | 'awaitingUserFeedback'
  | 'inProgress'
  | 'paused'
  | 'failed'
  | 'completed';
```

### Activity (Discriminated Union)

```typescript
type Activity =
  | ActivityAgentMessaged    // { type: 'agentMessaged', message: string }
  | ActivityUserMessaged     // { type: 'userMessaged', message: string }
  | ActivityPlanGenerated    // { type: 'planGenerated', plan: Plan }
  | ActivityPlanApproved     // { type: 'planApproved', planId: string }
  | ActivityProgressUpdated  // { type: 'progressUpdated', title, description }
  | ActivitySessionCompleted // { type: 'sessionCompleted' }
  | ActivitySessionFailed;   // { type: 'sessionFailed', reason: string }
```

All activities share:
```typescript
interface BaseActivity {
  name: string;        // "sessions/{id}/activities/{actId}"
  id: string;
  createTime: string;  // RFC 3339 timestamp
  originator: 'user' | 'agent' | 'system';
  artifacts: Artifact[];
}
```

### SessionOutput (Discriminated Union)

```typescript
type SessionOutput =
  | { type: 'pullRequest', pullRequest: { url, title, description } }
  | { type: 'changeSet', changeSet: { source, gitPatch: { unidiffPatch, baseCommitId } } };
```

---

## Network vs Cache Behavior

### Critical: In-Memory Cache Only

The SDK's `SessionStorage` and `ActivityStorage` are **in-memory**. In Convex, every action runs in a fresh V8 isolate, so **the cache is always empty**. Every SDK call hits the network.

### Method-by-Method Breakdown

| Method | Network? | Returns | Notes |
|--------|----------|---------|-------|
| `jules.sessions({}).all()` | **Yes** (paginated) | `SessionResource[]` | Fetches ALL sessions via multiple page requests. Supports `pageSize`, `limit`, `pageToken`. |
| `jules.sessions({})` (awaited) | **Yes** (first page only) | `ListSessionsResponse` | Returns first page + `nextPageToken`. |
| `jules.session(id)` | **No** | `SessionClient` | Just creates a client instance. No network call. |
| `session.info()` | **Yes** (always for us) | `SessionResource` | Read-through cache: checks storage first, then network. Since storage is always empty in Convex, always hits network. |
| `session.activities.list({})` | **Yes** | `{ activities: Activity[], nextPageToken? }` | Direct network call. Supports `filter`, `pageSize`, `pageToken`. |
| `session.activities.list({ filter })` | **Yes** (filtered) | `{ activities: Activity[], nextPageToken? }` | Server-side filtering. Use `create_time>"2026-03-30T10:00:00Z"`. |
| `session.activities.history()` | **Yes** (then cache) | `AsyncIterable<Activity>` | Calls `hydrate()` first (network), then yields from storage. |
| `session.activities.hydrate()` | **Yes** (incremental) | `number` (new activities synced) | Fetches only activities newer than latest cached one. Uses pageToken from latest `createTime`. |
| `session.activities.select(options)` | **No** (local only) | `Activity[]` | Queries local storage only. Fast but may be stale. |
| `session.activities.stream()` | **Yes** (polling) | `AsyncIterable<Activity>` | Opens polling connection. Yields future activities as they arrive. |
| `session.send(prompt)` | **Yes** | `void` | POST to `sessions/{id}:sendMessage`. Fire-and-forget. |
| `session.ask(prompt)` | **Yes** (send + poll) | `ActivityAgentMessaged` | Sends message, then polls stream for agent's reply. |
| `session.approve()` | **Yes** | `void` | POST to `sessions/{id}:approvePlan`. |
| `session.result()` | **Yes** (polling) | `SessionOutcome` | Polls until terminal state. |
| `session.waitFor(state)` | **Yes** (polling) | `void` | Polls until session reaches target state. |
| `session.snapshot()` | **Yes** (info + history) | `SessionSnapshot` | Fetches latest info + all activities. |
| `jules.select(query)` | **Yes** | `QueryResult[]` | Local graph query engine. Requires prior `sync()`. |
| `jules.sync(options)` | **Yes** | `SyncStats` | Reconciles local cache with API. Heavy operation. |

---

## Activity Filtering

### Server-Side Filter Syntax

The Jules API supports a `filter` parameter on `activities.list()`:

```typescript
session.activities.list({
  filter: 'create_time>"2026-03-30T10:00:00Z"',
});
```

**Format:** `field>value` or `field<value`
- Supported field: `create_time` (RFC 3339 timestamp)
- Comparison operators: `>`, `<`, `>=`, `<=`
- Values must be RFC 3339 timestamps

**Example — get activities since last poll:**
```typescript
const cutoff = new Date(lastProcessedActivityTime).toISOString();
const { activities } = await session.activities.list({
  filter: `create_time>"${cutoff}"`,
});
```

This is **server-side filtering** — the API only returns matching activities. Much more efficient than fetching all and filtering client-side.

### Client-Side Filtering (select)

```typescript
session.activities.select({
  type: 'agentMessaged',    // Filter by activity type
  after: 'activityId',      // Start after this activity (exclusive)
  before: 'activityId',     // Stop before this activity (exclusive)
  limit: 10,                // Max results
});
```

**IMPORTANT:** `select()` queries **local storage only**. If storage is empty (fresh Convex action), it returns nothing. You must call `hydrate()` or `history()` first to populate storage.

---

## Session Lifecycle

### Creation
```typescript
// New interactive session
const session = await jules.session({
  prompt: "Fix the login bug",
  source: { github: "owner/repo", baseBranch: "main" },
  requireApproval: true,  // Default true for session()
  autoPr: false,          // Default false for session()
});
```

### Rehydration
```typescript
// Reconnect to existing session (no network call)
const session = jules.session("EXISTING_SESSION_ID");
```

### State Transitions
```
queued → planning → awaitingPlanApproval → inProgress → completed/failed
                              ↓
                        awaitingUserFeedback → inProgress
```

- `awaitingPlanApproval`: Call `session.approve()` to continue
- `awaitingUserFeedback`: Call `session.send()` to provide feedback
- `completed`/`failed`: Terminal states. Can be resumed via `send()` or `approve()`.

### Outputs
- Available on `SessionResource.outputs` after completion
- Also available on `SessionOutcome.outputs` from `session.result()`
- Types: `pullRequest` or `changeSet`

---

## Pagination

### SessionCursor

```typescript
// Get first page only
const page = await jules.sessions({ pageSize: 10 });
console.log(page.sessions);        // SessionResource[]
console.log(page.nextPageToken);   // string | undefined

// Stream ALL sessions (auto-paginates)
for await (const session of jules.sessions()) {
  console.log(session.id);
}

// Get all into array (collects all pages)
const all = await jules.sessions({}).all();

// Limit total items
const last50 = [];
for await (const s of jules.sessions({ limit: 50 })) {
  last50.push(s);
}
```

### Activity Pagination

```typescript
// Manual pagination
let token: string | undefined;
do {
  const { activities, nextPageToken } = await session.activities.list({
    pageSize: 100,
    pageToken: token,
  });
  // process...
  token = nextPageToken;
} while (token);
```

---

## Error Handling

### SDK Error Types

```typescript
import { JulesError, AutomatedSessionFailedError, InvalidStateError } from '@google/jules-sdk';
```

| Error | When | How to handle |
|-------|------|---------------|
| `JulesError` | General API failures, network issues | Retry with backoff, or fail gracefully |
| `AutomatedSessionFailedError` | Session ends in `failed` state | Catch when calling `result()` or discovering sessions |
| `InvalidStateError` | Action invalid for current state (e.g., approve when not awaiting) | Check state before action, or catch and inform user |
| `JulesRateLimitError` | 429 from API | SDK auto-retries with exponential backoff (configurable via `rateLimitRetry`) |

### Network Errors

The SDK does NOT wrap HTTP errors in custom types for listing/info calls. A 401 (bad API key) or 500 (server error) will throw a generic `Error` with a `status` property.

```typescript
try {
  const sessions = await jules.sessions({}).all();
} catch (err: any) {
  if (err.status === 401) {
    // Invalid API key
  } else if (err.status === 429) {
    // Rate limited (SDK may have already retried)
  } else if (err.status >= 500) {
    // Server error
  }
}
```

---

## Configuration

### API Key Resolution

```typescript
// 1. Environment variable (preferred)
process.env.JULES_API_KEY

// 2. Explicit config
const jules = Jules({ apiKey: '...' });

// 3. Clone with different key
const specialized = jules.with({ apiKey: 'NEW_KEY' });
```

### Operational Config

```typescript
const jules = Jules({
  apiKey: '...',
  config: {
    pollingIntervalMs: 5000,      // Default: 5s
    requestTimeoutMs: 30000,      // Default: 30s
    rateLimitRetry: {
      maxRetryTimeMs: 300000,     // Default: 5min
      baseDelayMs: 1000,          // Default: 1s
      maxDelayMs: 30000,          // Default: 30s
    },
  },
});
```

---

## Usage in Convex (Stateless Environment)

### What Works
- All network calls work normally
- `jules.session(id)` (rehydrate) works — no cache needed
- `session.activities.list({ filter })` works — server-side filtering
- `sessions().all()` works — pagination handled by SDK

### What Doesn't Work
- **In-memory caching:** Every action is a fresh V8 isolate. Storage is always empty.
- **`session.activities.select()`:** Queries local storage only. Returns empty in Convex.
- **`session.activities.history()`:** Always triggers full `hydrate()` (network fetch).
- **`jules.select()`:** Requires prior `sync()` which populates local graph. Useless in Convex.
- **`jules.sync()`:** Heavy operation that populates local cache. Wasteful in stateless env.

### Best Practices for Convex

1. **Never use `select()`** — always use `list()` with `filter` for server-side filtering
2. **Never call `sessions().all()` in a loop** — call once, reuse the array
3. **Never call `session.info()` if you already have the data** — `sessions().all()` returns the same fields
4. **Use `filter: create_time>"..."` for activities** — avoids downloading all historical activities
5. **Pass data between tools via closures** — don't re-fetch in every tool call
6. **Wrap all Jules API calls in try/catch** — network failures are common

---

## Our Codebase Conventions

### Session Tracking States

| DB Field | Meaning |
|----------|---------|
| `acknowledged: false` | Session exists in Jules API but not yet registered in our system ("unregistered") |
| `acknowledged: true, inDashboard: false` | Registered but not actively tracked ("untracked") |
| `acknowledged: true, inDashboard: true` | Actively tracked in dashboard |
| `inDashboard: false, state: completed/failed` | Archived (removed from dashboard) |

### Jules API Key Resolution

1. Check user's `julesApiKey` in DB (via `getProviderConfigByThreadId`)
2. Fall back to `INITIAL_CONFIG.julesApiKey` (for testing/cron)
3. Throw if neither found

### Activity Processing

- Filter by `create_time > lastProcessedActivityTime` (server-side)
- Exclude `originator: 'user'` activities (we only care about agent activity)
- Process: `progressUpdated` (extract files), `agentMessaged` (wake agent), `planGenerated` (log), `sessionCompleted`/`sessionFailed` (final state)

---

## Gotchas

### 1. `source` is not a string
```typescript
// WRONG
const repo = session.source?.github;  // undefined

// CORRECT
const repo = session.source?.githubRepo
  ? `${session.source.githubRepo.owner}/${session.source.githubRepo.repo}`
  : "repoless";
```

### 2. `createTime` is a string, not a number
```typescript
// WRONG
const age = Date.now() - session.createTime;

// CORRECT
const age = Date.now() - new Date(session.createTime).getTime();
```

### 3. `session.info()` always hits network in Convex
The SDK's read-through cache is in-memory. In Convex stateless actions, storage is always empty. Every `info()` call is a network request.

### 4. `sessions().all()` returns the same data as `session.info()`
Both return `SessionResource` with identical fields: `id`, `title`, `state`, `source`, `createTime`, `updateTime`, `outputs`. Don't call `info()` if you already have the session from `sessions().all()`.

### 5. Activity `createTime` vs session `createTime`
- Session `createTime`: When the session was created
- Activity `createTime`: When the specific activity occurred
- Use activity `createTime` for filtering, session `createTime` for age/sorting

### 6. `AutomatedSessionFailedError` is thrown by `result()`, not by listing
When listing sessions, a failed session is just `state: "failed"`. The error is only thrown when you call `session.result()` on a failed session.

### 7. PageToken is an opaque string
Don't try to parse or construct pageTokens. They're nanosecond timestamps encoded by the API.

### 8. `jules.session(id)` strips `sessions/` prefix
```typescript
const client = jules.session("sessions/abc123");
client.id; // "abc123" (prefix stripped)
```

### 9. `outputs` on SessionResource may be empty during execution
Final outputs (PRs, changeSets) are only populated when the session reaches a terminal state. During execution, `outputs` is `[]`.

### 10. `activities.list()` without filter returns ALL activities
For sessions with hundreds of activities, this is expensive. Always use `filter: create_time>"..."` in polling scenarios.

---

## Quick Reference: Network Call Optimization

| Scenario | Bad | Good |
|----------|-----|------|
| Get state of N sessions | N × `session.info()` | 1 × `sessions().all()` + map by ID |
| Get new activities | `activities.list({})` (all) | `activities.list({ filter })` (incremental) |
| List sessions in tool | Call API every time | Pass pre-fetched array via closure |
| Check if session exists | `sessions().all()` + find | `jules.session(id).info()` (single) |
| Get session + activities | `info()` + `list({})` | `info()` + `list({ filter })` |
| Bulk update sessions | N × query + patch | 1 × query all + N × patch |

# Polling & Wakers Mechanism — Issue Tracker

> **Purpose:** Full audit of the poll cycle, agent wake mechanics, and waker event system.
> **Status:** Open — fixes not yet implemented.
> **Audience:** Agent implementing the fixes.

---

## System Overview

The poll cycle runs every 30 seconds via cron (`convex/crons.ts`). It:
1. Fetches all tracked (dashboard) sessions from DB
2. Calls `jules.sessions().all()` once to get live state from Jules API
3. Per tracked session: compares `lastKnownState` with current Jules state, fetches new activities
4. On state changes: builds a JIT system message, calls `generateText()` to wake the agent
5. On agent messages (same state): collects them as waker events, sends aggregated at the end
6. On COMPLETED: fetches full session outputs, processes them, calls `generateText()` again

User messages enter via Telegram webhook → `queueMessage` → `processMessageQueue` → `generateText()`.

The `isAgentRunning` flag on the user record prevents concurrent agent wakes from the Telegram path. **The poll path ignores this flag entirely.**

---

## Critical Bugs

### BUG-1: Double Agent Wake on Session Completion

**File:** `convex/polling/actions.ts`
**Lines:** 163-177 (state change wake) AND 186-228 (completion wake)

When a session transitions to COMPLETED, the code enters the state-change block (line 119) and calls `generateText()` at line 173. Then it enters the `if (currentUpper === "COMPLETED")` block at line 186 and calls `generateText()` AGAIN at line 222.

The agent wakes twice. The user gets two separate LLM responses for the same event. The first wake already sees "COMPLETED" in the session state from context, so it may act on completion before the second wake delivers the actual output details.

**Fix:** Merge into a single notification. When COMPLETED is detected, build the full message (state change + outputs) and call `generateText()` once. Do NOT call it at line 173 if we're about to enter the completion handler.

---

### BUG-2: No Concurrency Guard on Poll — `isAgentRunning` Ignored

**File:** `convex/polling/actions.ts`
**Lines:** 173, 222

The Telegram path (`convex/api/telegram.ts:428`) checks `isAgentRunning` before calling `generateText()`. The poll handler does NOT check this flag. It unconditionally calls `generateText()` on every state change.

**Race scenario:**
```
T=0.0s:  User sends "approve the plan"
T=0.1s:  queueMessage → isAgentRunning=false → schedules processMessageQueue
T=0.2s:  processMessageQueue → setAgentRunning(true) → generateText() starts (takes 15s)
T=1.0s:  Cron fires → pollJulesActivities → state changed
T=1.1s:  saveMessage() + generateText() on SAME THREAD while agent is mid-iteration
```

Two concurrent `generateText()` calls on the same thread. Behavior is undefined — context corruption, interleaved messages, or crashes.

**Fix:** Before calling `generateText()` in the poll, check `isAgentRunning` for the thread. If true, append the notification text to `pendingMessageText` instead. This unifies the two wake paths:

```typescript
// Pseudocode — unified wake function
async function wakeAgent(ctx, threadId, message) {
  const isRunning = await ctx.runQuery(internal.users.db.isAgentRunning, { threadId });
  if (isRunning) {
    await ctx.runMutation(internal.users.db.appendPendingMessage, { threadId, text: message });
  } else {
    await ctx.runMutation(internal.users.db.setAgentRunning, { threadId, isRunning: true });
    const { messageId } = await julesAgent.saveMessage(ctx, { threadId, message: { role: "user", content: message } });
    const model = modelCache.get(threadId);
    await julesAgent.generateText(ctx, { threadId }, { model, promptMessageId: messageId });
    await ctx.runMutation(internal.users.db.setAgentRunning, { threadId, isRunning: false });
    // drain pending messages if any arrived during generateText
    const pending = await ctx.runQuery(internal.users.db.getPendingMessages, { threadId });
    if (pending?.trim()) {
      await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, { threadId });
    }
  }
}
```

---

### BUG-3: Broken Re-trigger After Agent Error

**File:** `convex/api/telegram.ts`
**Lines:** 530-537

If `generateText()` fails, the `finally` block sets `isAgentRunning: false`. The code at lines 530-537 is supposed to re-trigger `processMessageQueue` for remaining pending messages, but it checks `!isRunning` — where `isRunning` was captured at line 449 as `false` (otherwise we would have returned at line 452). So `!isRunning` is always `true`, but the real problem is: this entire block reads stale state. The check doesn't account for new messages that arrived WHILE the agent was running.

**Fix:** In the `finally` block, unconditionally re-check `getPendingMessages`. If non-empty and `isAgentRunning` is now `false`, schedule `processMessageQueue`:

```typescript
finally {
  await ctx.runMutation(internal.users.db.setAgentRunning, { threadId, isRunning: false });
  const pending = await ctx.runQuery(internal.users.db.getPendingMessages, { threadId });
  if (pending?.trim()) {
    await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, { threadId, chatId });
  }
}
```

---

### BUG-4: Poll Cycle Overlap — No Mutex

**File:** `convex/polling/actions.ts`, `convex/crons.ts`
**Lines:** crons.ts:8 (30s interval), polling/actions.ts:21-240

If a poll cycle takes >30s (many sessions, slow Jules API), the next cron tick starts a new cycle while the first is still running. Both cycles will:
- Call `jules.sessions({}).all()` independently
- Fetch activities for the same sessions
- Potentially call `generateText()` on the same thread concurrently
- Write conflicting `lastProcessedActivityTime` values (second cycle's write overwrites first)

**Fix:** Add a poll-level mutex. Options:
1. DB field `pollInProgress: boolean` on a singleton config record
2. Track `lastPollStartTime` and skip if `Date.now() - lastPollStartTime < 30000`
3. Use Convex's scheduled action deduplication if available

---

### BUG-5: Wrong DB Index on All User Queries

**File:** `convex/sessions/db.ts` and other files querying `users` table
**Pattern (found in multiple locations):**

```typescript
// CURRENT (wrong — full table scan):
ctx.db.query("users")
  .withIndex("by_telegramChatId")
  .filter(q => q.eq(q.field("threadId"), threadId))
  .first();

// CORRECT (uses existing index):
ctx.db.query("users")
  .withIndex("by_threadId", q => q.eq("threadId", threadId))
  .first();
```

The `by_telegramChatId` index is on `[telegramChatId]`, but these queries filter by `threadId`. Convex cannot use the index for the filter — it does a full table scan. The schema defines `by_threadId` index at `convex/schema.ts:50`.

**Affected functions:** `appendPendingMessage`, `getPendingMessages`, `clearPendingMessages`, `setAgentRunning`, `isAgentRunning`, `getLastSearchingSent`, `updateLastSearchingSent` — any query in `users/db.ts` that filters by `threadId`.

---

### BUG-6: sendWakerEvents Resolves Model Fresh, Ignores Cache

**File:** `convex/polling/actions.ts`
**Line:** 270

The main poll loop eagerly resolves and caches models per thread (lines 43-49). But `sendWakerEvents` at line 270 calls `resolveLanguageModel(ctx, threadId)` fresh instead of receiving the cache. This is a wasted DB query per thread.

**Fix:** Pass `modelCache` as a parameter:
```typescript
await sendWakerEvents(ctx, wakerEvents, modelCache);
```
And in `sendWakerEvents`, use `modelCache.get(threadId)` instead of resolving again.

---

## Race Conditions

### RACE-1: User Message + Poll Concurrency

See BUG-2 above. The Telegram path and poll path can both call `generateText()` concurrently on the same thread.

### RACE-2: Poll Cycle Overlap

See BUG-4 above. Two 30s cycles can overlap.

### RACE-3: TOCTOU in queueMessage

**File:** `convex/api/telegram.ts`
**Lines:** 423-437

```
T=0ms:  appendPendingMessage (message queued)
T=1ms:  isAgentRunning check → false
T=2ms:  Poll fires, calls generateText() directly (no isAgentRunning check)
T=3ms:  processMessageQueue scheduled from T=1ms starts
T=4ms:  processMessageQueue checks isAgentRunning — state is undefined (poll didn't set it)
```

If the poll fires between `appendPendingMessage` and the `isAgentRunning` check, the poll's `generateText()` call doesn't set `isAgentRunning`, so `processMessageQueue` also proceeds. Two concurrent agent wakes.

---

## Redundancies

### REDUND-1: Dead WakerEvent Types

**File:** `convex/polling/actions.ts:13-19`

The `WakerEvent` interface defines types `"resumed" | "state_change" | "message"`. Only `"message"` is ever pushed into the `wakerEvents` array (line 101). `"state_change"` and `"resumed"` are dead code. Additionally, `sendWakerEvents` (line 259) only renders `"message"` events.

There's also a separate `WakerEvent` type in `convex/types/index.ts:327-333` with completely different types (`"discovered" | "message"`). The two definitions are incompatible. The shared type is never imported in polling.

**Fix:** Remove dead types. Either consolidate the type definitions or remove the unused one.

### REDUND-2: Duplicate telegramApiCall Functions

**Files:** `convex/api/telegram.ts:10-43` AND `convex/telegram/typingHeartbeat.ts:8-41`

Both files have identical `telegramApiCall` and `sendTelegramChatAction` functions. Extract to a shared utility.

### REDUND-3: processOutputs Called Twice Per Completion

**File:** `convex/polling/actions.ts:137` and `:200`

When a session completes with `progressUpdated` activities:
1. Line 137: `processOutputs(ctx, ..., act.artifacts, true, act.id)` — saves incremental output
2. Line 200: `processOutputs(ctx, ..., finalOutputs, false)` — saves final output

Both write to `sessionOutputs`. The incremental records persist even after the final records are written. This may cause confusion when fetching outputs later.

**Fix:** On completion, skip incremental output processing (line 137) and only process final outputs (line 200). Or delete incremental records when final records are written.

---

## Missing Features

### MISSING-1: No Orphaned Session Cleanup

**File:** `convex/polling/actions.ts:54-57`

Sessions that no longer exist on the Jules API are logged as warnings and skipped. They are never marked as stale/failed/archived. Over time, `julesSessions` accumulates orphaned records that are polled every 30 seconds.

**Fix:** After N consecutive "not found" results, mark the session as `FAILED` with a note, or archive it from the dashboard.

### MISSING-2: No Rate Limiting / Backoff on Jules API Failures

**File:** `convex/polling/actions.ts:36-39`

If the Jules API is down, every 30s poll logs an error and returns. No backoff, no circuit breaker.

**Fix:** Track consecutive failure count. After 3 failures, back off to 2min interval. After 10, back off to 5min. Reset on success.

### MISSING-3: No Heartbeat Dead-Man's Switch

**File:** `convex/telegram/typingHeartbeat.ts`

The heartbeat reschedules every 4s as long as `isAgentRunning` is true. If the agent crashes without clearing `isAgentRunning` (e.g., Convex action timeout, unhandled exception before `finally`), the heartbeat runs forever and the agent can never be woken again (because `isAgentRunning` stays `true` and `processMessageQueue` returns early).

**Fix:** Add a `agentRunningSince: number` timestamp. If `isAgentRunning && Date.now() - agentRunningSince > 120000` (2 min), force-reset to `false`.

---

## Recommended Architecture: Unified Wake Path

The core recommendation is to replace the two separate wake paths (Telegram + Poll) with a single `wakeAgent` function that handles `isAgentRunning` consistently:

```
wakeAgent(threadId, message) {
  if (isAgentRunning(threadId)) {
    appendToPending(threadId, message)    // queue it
  } else {
    setAgentRunning(threadId, true)
    saveMessage(threadId, message)
    generateText(threadId)
    setAgentRunning(threadId, false)
    drainPending(threadId)                // re-trigger if more arrived
  }
}
```

Then:
- Telegram path: `wakeAgent(threadId, pendingMessages)`
- Poll path: `wakeAgent(threadId, jitNotification)`
- Completion path: single `wakeAgent(threadId, fullCompletionMessage)` instead of two `generateText()` calls
- `sendWakerEvents` becomes unnecessary — all events go through `wakeAgent`

This eliminates BUG-1 (double wake), BUG-2 (concurrency), BUG-3 (broken re-trigger), and RACE-1/3 in one refactor.

---

## Priority Order

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | BUG-2: Concurrency guard (unified wake path) | Medium — refactor wake logic |
| P0 | BUG-1: Double wake on completion | Low — merge two calls into one |
| P0 | BUG-3: Broken re-trigger after error | Low — fix finally block |
| P1 | BUG-4: Poll cycle overlap mutex | Low — add a guard flag |
| P1 | BUG-5: Wrong DB index on user queries | Low — one-line fix per query |
| P2 | BUG-6: Model cache not passed to sendWakerEvents | Trivial |
| P2 | REDUND-1: Dead WakerEvent types | Trivial |
| P2 | REDUND-2: Duplicate telegramApiCall | Trivial |
| P3 | MISSING-3: Heartbeat dead-man's switch | Low |
| P3 | MISSING-1: Orphaned session cleanup | Low |
| P3 | MISSING-2: API failure backoff | Low |

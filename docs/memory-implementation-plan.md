# Hermes-Style Curated Memory Implementation Plan

## Overview

Complete replacement of the current Observational Memory system with a Hermes-inspired curated memory system. Single-user Telegram bot, no prompt caching, no vector search, all data in Convex DB.

---

## Design Philosophy

The agent curates its own memory explicitly via a `memory` tool, rather than relying on a background observer LLM to guess what matters. The agent is already reading the conversation — it's the best judge of what's worth remembering. A separate observer is an expensive middleman that often extracts the wrong things.

The observer is deleted entirely. The agent gets a `memory` tool and a periodic nudge to use it.

---

## Decisions

| Decision | Choice |
|----------|--------|
| Messages on compaction | Keep all, filter in contextHandler |
| Compaction summary storage | Separate `threadSummaries` table (thread `summary` field is metadata-only — framework does NOT auto-inject it) |
| Nudge counter | Persisted in `users` table (survives cold starts/resets) |
| Pre-compaction flush | Yes — LLM call with only memory tool to save facts before compressing |
| searchOtherThreads | Enable, text search only (no vector/embedding) |
| Memory tool pattern | `createTool` v6 API (`inputSchema` with Zod, `execute` handler), uses `ctx.runMutation`/`ctx.runQuery` for DB |
| Command changes | `/reset` → `/nuke`, keep `/new` (simplified), add new `/reset` (clear convo, keep memory) |
| Memory injection | Manual in contextHandler: read entries + thread summary from DB |
| File storage | All in Convex DB, no file writes |
| Character limits | 2200 chars (memory), 1375 chars (user profile) — Hermes values, model-independent |
| Nudge interval | 10 turns, persisted in `users` table |
| Security scanning | Hermes-style injection/exfil pattern checking on every write |
| Replace/remove mechanism | Exact substring matching (Hermes design) — guardrails: multiple-match rejection with previews, budget enforcement, content scanning |

---

## Quirks & Gotchas

1. **`ctx.userId` in tools**: In the Convex agent framework, `ctx.userId` in a tool's `execute` function is the `userId` passed to `generateText`. In `processMessageQueue`, you must pass `userId: telegramChatId` alongside `threadId`:
   ```typescript
   await julesAgent.generateText(ctx, { threadId, userId: telegramChatId }, { model, prompt: batchPrompt });
   ```

2. **`searchOtherThreads` requires `userId`**: The framework looks up `userId` from the thread if not provided. Threads must be created with `userId` set:
   ```typescript
   const newThreadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });
   ```

3. **Memory flush tool passing**: The `memoryFlush` action calls `julesAgent.generateText` with `tools: { memory: tools.memory }`. When `tools` is provided at the call site, it completely replaces the agent's default tools. The context handler still runs (injecting memory + context), automatic message saving still works, and the LLM can only call `memory(add, ...)` or respond with text. This is the same pattern used in `human.ts` and `ragAsTools.ts` in the Convex agent repo.

4. **Replace/remove substring matching**: Exact substring matching (`old_text in entry`), no fuzzy matching. Case-sensitive. The LLM is responsible for crafting a unique-enough substring. Error responses include 80-char previews of ambiguous matches so the LLM can self-correct. This is the exact Hermes design — battle-tested with guardrails for ambiguous/no matches.

5. **Compaction message boundaries**: Convex agent's `listMessagesByThreadId` uses `order` and `stepOrder` for message ordering. `HEAD_PROTECT` and `TAIL_PROTECT` work on the message list returned (already ordered), not on the `order` field directly. The `summarizedUpToOrder` stored in `threadSummaries` uses the `order` field of the last middle message.

6. **Nudge counter in contextHandler**: Counter increments on every `generateText`/`streamText` call (contextHandler is called once per generation), not on every user message. If the agent makes multiple tool calls in one turn, the counter only increments once.

7. **Thread summary is not auto-injected**: The Convex agent framework does NOT automatically inject thread `summary` into the LLM context. The `contextHandler` receives only `ModelMessage[]` arrays plus `userId`/`threadId` strings — no thread document. We must manually read the summary from our `threadSummaries` table and inject it.

8. **`threadSummaries` vs thread metadata**: We use a separate table instead of `thread.updateMetadata({ patch: { summary } })` because: (a) the summary is not auto-injected anyway, (b) a separate table gives us `summarizedUpToOrder` tracking, and (c) we control the schema fully.

---

## Schema Changes

### File: `convex/schema.ts`

**Delete** (lines 96-101):
```typescript
observationalMemory: defineTable({
  threadId: v.string(),
  activeObservations: v.string(),
  lastObservedAt: v.number(),
  observationTokenCount: v.number(),
}).index("by_threadId", ["threadId"]),
```

**Add:**
```typescript
memoryEntries: defineTable({
  userId: v.string(),           // telegramChatId — per-user, not per-thread
  target: v.union(v.literal("memory"), v.literal("user")),
  content: v.string(),          // single entry, can be multiline
  createdAt: v.number(),
}).index("by_user_and_target", ["userId", "target"]),

threadSummaries: defineTable({
  threadId: v.string(),
  summary: v.string(),              // LLM-generated summary of compacted messages
  summarizedUpToOrder: v.number(),  // message order up to which we've summarized
  createdAt: v.number(),
}).index("by_threadId", ["threadId"]),
```

**Modify** `users` table — add nudge counter field:
```typescript
memoryNudgeCount: v.optional(v.number()),  // turns since last memory nudge (defaults to 0)
```

---

## Step 1: Memory DB Functions

### File: `convex/memory/db.ts` — COMPLETE REWRITE

Delete the old file entirely. New contents:

**Constants:**
- `MEMORY_CHAR_LIMIT = 2200`
- `USER_CHAR_LIMIT = 1375`
- `ENTRY_DELIMITER = "\n§\n"`

**Functions to implement:**

| Function | Type | Purpose |
|----------|------|---------|
| `getEntries(userId, target)` | internalQuery | Get all entries for user+target, ordered by createdAt asc |
| `getCharCount(userId, target)` | internalQuery | Get total char count across all entries for user+target |
| `addEntry(userId, target, content)` | internalMutation | Add new entry with security scan, duplicate check, char limit enforcement |
| `replaceEntry(userId, target, oldText, newContent)` | internalMutation | Substring match, replace in place with budget check |
| `removeEntry(userId, target, oldText)` | internalMutation | Substring match, delete entry |
| `getNudgeCount(telegramChatId)` | internalQuery | Get current nudge counter value |
| `incrementNudgeCounter(telegramChatId)` | internalMutation | Increment counter by 1, return new value |
| `resetNudgeCounter(telegramChatId)` | internalMutation | Set counter to 0 |
| `getThreadSummary(threadId)` | internalQuery | Get latest summary for a thread |
| `upsertThreadSummary(threadId, summary, summarizedUpToOrder)` | internalMutation | Delete existing summary for thread, insert new one |

**`addEntry` logic:**
1. Trim content, reject empty
2. Security scan (call `scanMemoryContent`)
3. Fetch existing entries for user+target
4. Check exact duplicates — if exists, return success with "Entry already exists"
5. Calculate new total char count (all entries + delimiters)
6. If would exceed limit → reject with current usage info and suggestion to replace/remove
7. Insert new row
8. Return success with entries list and usage percentage

**`replaceEntry` logic:**
1. Trim oldText and newContent, reject empty
2. Security scan on newContent only (oldText is just an identifier)
3. Fetch existing entries
4. Find entries where `oldText in e.content` (substring match)
5. 0 matches → error: "No entry matched 'oldText'."
6. Multiple matches with different content → error with 80-char previews, "Be more specific"
7. Multiple matches with identical content → silently operate on first (dedup)
8. Check char limit after replacement
9. Patch the entry row
10. Return success with updated entries

**`removeEntry` logic:**
1. Same as replace but without new content
2. Same matching logic (0/multiple/identical handling)
3. Delete the matching row
4. Return success with remaining entries

**`successResponse` helper:**
```typescript
function successResponse(entries: string[], target: string, message?: string) {
  const limit = charLimit(target);
  const current = entries.length > 0 ? ENTRY_DELIMITER.join(entries).length : 0;
  const pct = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  // return { success, target, entries, usage, entryCount, message? }
}
```

**Security scanning** (inlined in db.ts or separate `security.ts`):

Threat patterns (from Hermes):
- `ignore\s+(previous|all|above|prior)\s+instructions` → prompt_injection
- `you\s+are\s+now\s+` → role_hijack
- `do\s+not\s+tell\s+the\s+user` → deception_hide
- `system\s+prompt\s+override` → sys_prompt_override
- `disregard\s+(your|all|any)\s+(instructions|rules|guidelines)` → disregard_rules
- `act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)` → bypass_restrictions
- `curl\s+... \$\{?\w*(KEY|TOKEN|SECRET|...)` → exfil_curl
- `wget\s+... \$\{?\w*(KEY|TOKEN|SECRET|...)` → exfil_wget
- `cat\s+... (.env|credentials|...)` → read_secrets
- `authorized_keys` → ssh_backdoor
- `$HOME/.ssh` or `~/.ssh` → ssh_access
- Invisible unicode chars (U+200B, U+200C, etc.) → blocked

---

## Step 2: Memory Tool

### File: `convex/memory/tool.ts` — NEW FILE

Follows the exact `createTool` v6 pattern from `convex/tools/index.ts` (inputSchema with Zod, execute handler).

**Tool definition:**
```typescript
export const memory = createTool({
  description: "Save durable information to persistent memory...", // long behavioral guidance
  inputSchema: z.object({
    action: z.enum(["add", "replace", "remove"]),
    target: z.enum(["memory", "user"]),
    content: z.string().optional(),
    old_text: z.string().optional(),
  }),
  execute: async (ctx, args): Promise<string> => {
    // 1. Validate ctx.userId exists
    // 2. Reset nudge counter (agent is using memory voluntarily)
    // 3. Dispatch to addEntry/replaceEntry/removeEntry via ctx.runMutation
    // 4. Return JSON string result
  },
});
```

**Key behaviors:**
- Returns JSON strings (not objects) — what the Convex agent framework expects
- Resets the nudge counter on every call (agent is engaging with memory voluntarily)
- `ctx.userId` is the `telegramChatId` (must be passed as `userId` in `generateText` calls)
- Description field is intentionally long (~700 chars) — it's the behavioral guidance the LLM uses to decide when/what to save

**Full description text** (from the plan's Step 3 in the previous message — the "WHEN TO SAVE" / "TWO TARGETS" / "ACTIONS" / "SKIP" sections).

---

## Step 3: Compaction

### File: `convex/memory/compaction.ts` — NEW FILE

Two actions: `memoryFlush` (pre-compaction save) and `compactMemory` (main compaction).

**`memoryFlush(threadId, telegramChatId)` — internalAction:**

1. Fetch last 50 messages from thread via `listMessagesByThreadId`
2. Fetch existing memory + user entries for `telegramChatId`
3. Build flush prompt: existing memory + recent conversation + "save anything worth remembering"
4. Call `julesAgent.generateText` with `tools: { memory: tools.memory }` (only memory tool available)
5. Context handler still runs, injecting context + existing memory
6. LLM can call `memory(add, ...)` or respond "Nothing to save"
7. Fire-and-forget errors (non-fatal)

**`compactMemory(threadId)` — internalAction:**

1. Fetch all messages via `listMessagesByThreadId` (desc, 1000 items)
2. Split: `head = messages[0..HEAD_PROTECT]`, `tail = messages[-TAIL_PROTECT..]`, `middle = messages[HEAD_PROTECT..-TAIL_PROTECT]`
3. `HEAD_PROTECT = 3`, `TAIL_PROTECT = 10`
4. If `middle.length === 0`, return early
5. Serialize middle messages for summarization
6. Fetch existing thread summary from `threadSummaries` table
7. If existing summary exists: prompt for iterative update (preserve existing, add new, move In Progress → Done)
8. If no existing summary: prompt for fresh structured summary
9. Summary sections: Goal, Progress (Done/In Progress), Key Decisions, Relevant Files, Next Steps, Critical Context
10. Store via `upsertThreadSummary(threadId, summary, lastMiddleOrder)`
11. Messages are NOT deleted — contextHandler filters based on `summarizedUpToOrder`

---

## Step 4: Context Handler

### File: `convex/agent/instance.ts` — REWRITE `unifiedContextHandler`

**Remove:**
- `filteredMessages` logic (lines 76-80) — no more filtering by `lastObservedAt`
- `initializeMemory` call (lines 68-71)
- `scheduleObservation` call (line 74)
- `MemoryDoc` interface (lines 10-13)

**New flow:**
```typescript
export const unifiedContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, userId, recent, search } = args;
  if (!threadId) return args.allMessages;
  const telegramChatId = userId;

  // Parallel fetch
  const [memoryEntries, userEntries, threadSummary, sessions, tasks, files, sessionFileCounts, nudgeCount] = await Promise.all([
    ctx.runQuery(internal.memory.db.getEntries, { userId: telegramChatId, target: "memory" }),
    ctx.runQuery(internal.memory.db.getEntries, { userId: telegramChatId, target: "user" }),
    ctx.runQuery(internal.memory.db.getThreadSummary, { threadId }),
    ctx.runQuery(internal.sessions.db.getAllSessions, {}),
    ctx.runQuery(internal.tasks.listTasksForThread, { threadId }),
    ctx.runQuery(internal.files.db.getThreadFiles, { threadId }),
    ctx.runQuery(internal.sessions.db.getSessionOutputCounts, { threadId }),
    ctx.runQuery(internal.memory.db.getNudgeCount, { telegramChatId }),
  ]);

  const contextMessages = [];

  // 1. Thread summary (compacted older conversation)
  if (threadSummary?.summary) {
    contextMessages.push({
      role: "user",
      content: `### CONTEXT SUMMARY (earlier conversation compacted)\n${threadSummary.summary}`,
    });
  }

  // 2. Memory entries (agent's curated notes)
  if (memoryEntries.length > 0) {
    const content = memoryEntries.map(e => e.content).join("\n§\n");
    const pct = Math.min(100, Math.round((content.length / 2200) * 100));
    contextMessages.push({
      role: "user",
      content: `### MEMORY (your personal notes) [${pct}% — ${content.length.toLocaleString()}/2,200 chars]\n${content}`,
    });
  }

  // 3. User profile entries
  if (userEntries.length > 0) {
    const content = userEntries.map(e => e.content).join("\n§\n");
    const pct = Math.min(100, Math.round((content.length / 1375) * 100));
    contextMessages.push({
      role: "user",
      content: `### USER PROFILE (who the user is) [${pct}% — ${content.length.toLocaleString()}/1,375 chars]\n${content}`,
    });
  }

  // 4. MY LIST (sessions) — unchanged
  // 5. Tasks — unchanged
  // 6. Inbox — unchanged

  // 7. Memory nudge
  if ((nudgeCount ?? 0) >= 10) {
    await ctx.runMutation(internal.memory.db.resetNudgeCounter, { telegramChatId });
    contextMessages.push({
      role: "user",
      content: `[System: Review the conversation so far. Have you learned anything worth saving? Use the memory tool to add/update entries. Focus on: user preferences, corrections, environment facts, project conventions, decisions made. Skip: task progress, session outcomes, temporary state.]`,
    });
  } else {
    ctx.runMutation(internal.memory.db.incrementNudgeCounter, { telegramChatId });
  }

  // 8. Slow tools guidance — unchanged

  // Return: search results + recent messages + context
  return [...search, ...recent, ...contextMessages];
};
```

**Key differences from current:**
- Uses `args.recent` (unfiltered) instead of `filteredMessages`
- Uses `args.search` for `searchOtherThreads` text search results (framework handles this automatically)
- Fetches memory entries by `userId` (per-user) not `threadId` (per-thread)
- Fetches thread summary from our `threadSummaries` table
- Nudge logic with persisted counter
- No observer scheduling
- No `initializeMemory`

---

## Step 5: Agent Definition

### File: `convex/agent/instance.ts` — MODIFY `julesAgent`

**Add memory tool and contextOptions:**

```typescript
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
    message_user: tools.message_user,
    query_sessions: tools.query_sessions,
    memory: tools.memory,  // NEW
  },
});
```

---

## Step 6: Telegram Commands

### File: `convex/api/telegram.ts` — MODIFY `handleTelegramCommand`

**Rename `/reset` to `/nuke`:**
```typescript
case "/nuke":
  await telegramApiCall("sendMessage", {
    chat_id: chatId,
    text: "⚠️ <b>Nuke All Data</b>\n\nThis will permanently delete ALL memory, tasks, files, and conversation history. Your API keys will be kept.\n\nAre you sure?",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Yes, nuke everything", callback_data: "nuke_confirm" }],
        [{ text: "Cancel", callback_data: "nuke_cancel" }],
      ],
    },
  });
  return true;
```

**Update `/new` — simplified, no handover summary:**
```typescript
case "/new":
  await sendTelegramMessage(chatId,
    "🆕 <b>Starting fresh...</b> New conversation thread. Memory and user profile preserved."
  );
  await ctx.scheduler.runAfter(0, internal.users.actions.cycleThreadAction, {
    telegramChatId: chatId,
  });
  return true;
```

**Add new `/reset` — clear conversation, keep memory:**
```typescript
case "/reset":
  await sendTelegramMessage(chatId,
    "🔄 <b>Resetting conversation...</b> Keeping your memory and user profile."
  );
  await ctx.scheduler.runAfter(0, internal.users.actions.resetConversationAction, {
    telegramChatId: chatId,
  });
  return true;
```

**Update `/compact` — flush then compact:**
```typescript
case "/compact":
  await sendTelegramMessage(chatId,
    "🧹 <b>Compacting conversation...</b>\n\nSaving important facts first, then summarizing older messages."
  );
  await ctx.scheduler.runAfter(0, internal.memory.compaction.memoryFlush, {
    threadId,
    telegramChatId: chatId,
  });
  await ctx.scheduler.runAfter(2000, internal.memory.compaction.compactMemory, {
    threadId,
  });
  return true;
```

**Update `/help`:**
```typescript
case "/help":
  await sendTelegramMessage(chatId,
    "📖 <b>Jules Dispatch Help</b>\n\n" +
    "/connect - Configure your AI provider and API key\n" +
    "/new - Start fresh conversation (keeps memory)\n" +
    "/reset - Clear conversation only (keeps memory)\n" +
    "/compact - Summarize older messages to save context\n" +
    "/nuke - Nuclear: wipe ALL data (memory, tasks, files)\n" +
    "/start - Show welcome message\n\n" +
    "Simply send me a message or a file to get started!"
  );
  return true;
```

---

## Step 7: Thread Cycling

### File: `convex/users/db.ts` — MODIFY `cycleUserThread`

Simplify — memory entries are per-user (keyed by `telegramChatId`), not per-thread. Nothing to move.

```typescript
export const cycleUserThread = internalMutation({
  args: { telegramChatId: v.string(), preserveMemory: v.boolean() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();
    if (!user) return null;

    const oldThreadId = user.threadId;
    const newThreadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });

    await ctx.db.patch(user._id, {
      threadId: newThreadId,
      isAgentRunning: false,
      pendingMessageText: undefined,
    });

    // Memory entries keyed by userId — nothing to move
    // Thread summaries stay with old thread (it's history)

    return { oldThreadId, newThreadId };
  },
});
```

### File: `convex/users/db.ts` — ADD `resetConversationAction`

New mutation for `/reset` command — deletes messages + thread summaries but keeps memory entries:

```typescript
export const resetConversation = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();
    if (!user) return;

    const oldThreadId = user.threadId;

    // Delete thread summaries
    const summaries = await ctx.db
      .query("threadSummaries")
      .withIndex("by_threadId", (q) => q.eq("threadId", oldThreadId))
      .collect();
    for (const s of summaries) await ctx.db.delete(s._id);

    // Delete old thread messages
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: oldThreadId,
    });

    // Create new thread
    const newThreadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });
    await ctx.db.patch(user._id, {
      threadId: newThreadId,
      isAgentRunning: false,
      pendingMessageText: undefined,
    });

    // Memory entries untouched — they're per-user
  },
});
```

### File: `convex/users/actions.ts` — SIMPLIFY `cycleThreadAction`

Remove handover summary logic. Memory persists automatically (per-user).

```typescript
export const cycleThreadAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const ids = await ctx.runMutation(internal.users.db.cycleUserThread, {
      telegramChatId: args.telegramChatId,
      preserveMemory: true,
    });
    if (!ids) return;

    // Cleanup old thread files
    const storageIds = await ctx.runMutation(internal.files.db.deleteFilesForThread, {
      threadId: ids.oldThreadId,
    });
    for (const sid of storageIds) await ctx.storage.delete(sid);

    // Delete old thread messages
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: ids.oldThreadId,
    });

    return ids.newThreadId;
  },
});
```

### File: `convex/users/actions.ts` — ADD `resetConversationAction`

```typescript
export const resetConversationAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.users.db.resetConversation, {
      telegramChatId: args.telegramChatId,
    });
  },
});
```

### File: `convex/users/db.ts` — UPDATE `nukeUserData`

Add memory entries + thread summaries cleanup (replaces old `observationalMemory` cleanup):

```typescript
// Replace lines 298-300 with:
// 4b. Delete ALL memoryEntries
const allMemoryEntries = await ctx.db.query("memoryEntries").collect();
for (const m of allMemoryEntries) await ctx.db.delete(m._id);

// 4c. Delete ALL threadSummaries
const allSummaries = await ctx.db.query("threadSummaries").collect();
for (const s of allSummaries) await ctx.db.delete(s._id);
```

---

## Step 8: Tools Barrel File

### File: `convex/tools/index.ts` — ADD EXPORT

Add at the end of the file (with the other re-exports):
```typescript
export { memory } from "../memory/tool";
```

---

## Step 9: Process Message Queue Update

### File: `convex/api/telegram.ts` — MODIFY `processMessageQueue`

Must pass `userId` so the memory tool can key entries correctly:

```typescript
// Line 489-494, change to:
const model = await resolveLanguageModel(ctx, threadId);
await julesAgent.generateText(
  ctx,
  { threadId, userId: telegramChatId },
  { model, prompt: batchPrompt },
);
```

---

## Step 10: Agent Instructions Update

### File: `convex/agent/instructions.ts` — UPDATE

Replace any existing "memory" or "Observational Memory" section with:

```
## Memory System
You have a persistent memory tool that saves facts across conversations.

Two stores:
- 'memory': your personal notes — environment facts, project conventions, tool quirks, lessons learned
- 'user': user profile — name, preferences, communication style, pet peeves

Use the memory tool proactively when you learn something that will matter in future conversations.
You'll see your memory usage percentage — manage it by replacing outdated entries or removing stale ones.

Every 10 turns you'll get a review prompt — audit the conversation and save anything worth remembering.

Do NOT save: task progress, session outcomes, completed-work logs, or temporary TODO state.
```

---

## Step 11: Cleanup

**Delete entirely:**
- `convex/memory/instructions.ts` — observer instructions (no observer)
- `convex/memory/processor.ts` — observer + old compaction (replaced by `compaction.ts`)
- `convex/memory/index.ts` — old re-exports

**Create:**
- `convex/memory/index.ts` — new barrel: `export { memory } from "./tool";`

---

## Step 12: Documentation

### File: `AGENT.md` — UPDATE

Replace the "Observational Memory System (Long Conversation Compaction)" section (lines 232-261) with documentation of the new system.

---

## Execution Order

1. **Schema** (Step 7 for thread cycling changes to `users` table + new tables) — must be first
2. **Memory DB functions** (Step 1) — foundation for everything
3. **Memory tool** (Step 2) — depends on Step 1
4. **Compaction** (Step 3) — depends on Step 1
5. **Context handler + agent definition** (Steps 4-5) — depends on Steps 1-3
6. **Telegram commands** (Step 6) — depends on Steps 1-3
7. **Thread cycling changes** (Step 7) — depends on schema
8. **Tools barrel + processMessageQueue** (Steps 8-9) — depends on Step 2
9. **Agent instructions** (Step 10) — last
10. **Cleanup** (Step 11) — after everything is migrated
11. **Docs** (Step 12) — last

---

## File Summary

| File | Action | Depends On |
|------|--------|------------|
| `convex/schema.ts` | Modify: replace `observationalMemory` with `memoryEntries` + `threadSummaries`, add `memoryNudgeCount` to users | Nothing |
| `convex/memory/db.ts` | Rewrite: new CRUD + nudge counter + summary functions | Schema |
| `convex/memory/tool.ts` | Create: `memory` tool with createTool v6 | db.ts |
| `convex/memory/compaction.ts` | Create: `memoryFlush` + `compactMemory` actions | db.ts, tool.ts |
| `convex/memory/index.ts` | Rewrite: re-export tool | tool.ts |
| `convex/agent/instance.ts` | Modify: rewrite contextHandler, add memory tool + contextOptions | db.ts, tool.ts |
| `convex/api/telegram.ts` | Modify: command changes, pass userId | compaction.ts |
| `convex/users/db.ts` | Modify: simplify cycleUserThread, add resetConversation, update nukeUserData | Schema |
| `convex/users/actions.ts` | Modify: simplify cycleThreadAction, add resetConversationAction | db.ts |
| `convex/tools/index.ts` | Modify: add memory export | tool.ts |
| `convex/agent/instructions.ts` | Modify: update memory section | Nothing |
| `convex/memory/instructions.ts` | Delete | — |
| `convex/memory/processor.ts` | Delete | — |
| `AGENT.md` | Update memory section | All |

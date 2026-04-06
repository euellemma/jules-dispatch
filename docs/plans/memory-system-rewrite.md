# Memory System Rewrite — Implementation Plan

## Overview

Replace the current observational memory system (observer LLM + background compaction) with a
Hermes-style curated memory system. The agent explicitly saves facts via a `memory` tool,
backed by a `memoryEntries` table in Convex DB. No background observer, no extra LLM calls
for memory extraction — the agent curates its own memory during normal conversation.

**Derived from:** Hermes Agent's `MemoryStore` + `MemoryProvider` + `MemoryManager` architecture
at `docs/hermes-agent-main/`.

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Messages on compaction | Keep all, filter in contextHandler | Preserves search history across threads |
| Compaction summary storage | `thread.summary` via `updateMetadata` | Existing Convex field, no extra table |
| Summary auto-injection | No — manually read in contextHandler | Framework doesn't auto-inject `summary` |
| Nudge counter | In-memory (resets on cold start) | Acceptable for single-thread Telegram bot |
| Pre-compaction flush | Yes — LLM call with only memory tool | Saves facts before context is compressed |
| searchOtherThreads | Text search only, no vector search | Simpler, no embedding model needed |
| Memory tool pattern | `createTool` v6 API (Zod + `execute`) | Matches existing tool definitions |
| Character limits | 2200 memory, 1375 user profile | Model-independent, deterministic |
| Entry delimiter | `§` (section sign) | Matches Hermes convention |
| Prompt caching | Not applicable — APIs don't support it | Simplifies design, no frozen snapshots |

---

## Quirks & Gotchas

### 1. `thread.summary` is not auto-injected
Convex agent's `contextHandler` receives `ModelMessage[]` arrays + `userId`/`threadId` strings.
It does NOT receive the thread document. To inject a compaction summary, we must manually call
`ctx.runQuery(component.threads.getThread, { threadId })` inside contextHandler and prepend
the summary as a context message. The `summary` field on threads is described as
"Not currently used for anything" in the Convex agent JSDoc.

### 2. `searchOtherThreads` needs `userId` on threads
For cross-thread search to work, threads must have `userId` set. Currently `createThread` is
called in `cycleUserThread` without a `userId`. We need to pass `userId: telegramChatId` when
creating threads. **Verify existing threads have userId set or backfill.**

### 3. `contextHandler` args shape
The `contextHandler` receives `(ctx, args)` where `args` has:
- `args.search` — messages from text search (empty if no search triggered)
- `args.recent` — recent messages from the thread
- `args.inputMessages` — messages passed via `messages` arg
- `args.inputPrompt` — the prompt message
- `args.existingResponses` — existing responses at same order
- `args.allMessages` — all of the above combined
- `args.userId` — string | undefined
- `args.threadId` — string | undefined

We return `ModelMessage[]`. The default returns `[...search, ...recent, ...inputMessages, ...inputPrompt, ...existingResponses]`.
We inject memory/context messages between `recent` and `inputMessages`.

### 4. Memory tool returns JSON string
All `createTool` handlers must return `string`. The memory tool returns JSON with
`{ success, target, entries, usage, entry_count, message }`. The agent parses this.
This matches the Hermes pattern where all tool handlers return JSON strings.

### 5. Character counting is not token counting
We use `char.length` (not `Math.ceil(text.length / 4)`). This is model-independent and
deterministic. The limits are calibrated to roughly 550 tokens (memory) and 340 tokens (user)
at ~4 chars/token, but the limits themselves are in chars.

### 6. Entry deduplication
Exact string match for duplicates. After trimming whitespace. If `content.trim()` already
exists in entries, reject with "Entry already exists (no duplicate added)."

### 7. Substring matching for replace/remove
`old_text` is a short unique substring. If 0 matches → error. If >1 matches with different
content → error with previews. If >1 matches with identical content → operate on first
(dedup safety).

### 8. `cycleUserThread` needs rework
Currently it patches the `observationalMemory` row to point to the new threadId.
With per-user memory (keyed by `userId`, not `threadId`), this is unnecessary.
Memory entries are keyed by `userId = telegramChatId` and survive thread cycling automatically.

### 9. `/nuke` must delete `memoryEntries`
The `nukeUserData` mutation currently deletes `observationalMemory` rows. It needs to also
delete all `memoryEntries` for the user.

### 10. `extractTextContent` helper
The compaction action needs a helper to extract text from Convex agent messages, which may
have `content` as a string or as an array of `{ type: "text", text }` objects.

---

## Schema Changes

### Remove from `convex/schema.ts`
```typescript
// DELETE THIS TABLE
observationalMemory: defineTable({
  threadId: v.string(),
  activeObservations: v.string(),
  lastObservedAt: v.number(),
  observationTokenCount: v.number(),
}).index("by_threadId", ["threadId"]),
```

### Add to `convex/schema.ts`
```typescript
memoryEntries: defineTable({
  userId: v.string(),           // telegramChatId — per-user, NOT per-thread
  target: v.union(v.literal("memory"), v.literal("user")),
  content: v.string(),          // single entry, can be multiline
  createdAt: v.number(),
}).index("by_user_and_target", ["userId", "target"]),
```

---

## File Changes

### DELETE files
- `convex/memory/instructions.ts` — observer instructions (no observer)
- `convex/memory/processor.ts` — observer + old compaction logic

### NEW files

#### `convex/memory/db.ts` (replace entirely)
```
Functions:
  getEntries(userId, target)
    → internalQuery
    → returns MemoryEntryDoc[] sorted by createdAt asc

  addEntry(userId, target, content)
    → internalMutation
    → trim content, reject empty
    → scan for injection/exfil (call security.scanContent)
    → re-read entries under transaction
    → reject exact duplicates
    → calculate new total char count (entries + delimiters)
    → if exceeds limit → reject with current usage info
    → insert row
    → return { success, entries, usage, entry_count, message }

  replaceEntry(userId, target, oldText, newContent)
    → internalMutation
    → trim both, reject empty
    → scan newContent for injection
    → re-read entries
    → substring match on oldText
    → 0 matches → error
    → >1 matches with different content → error with previews
    → >1 matches with identical content → operate on first
    → check replacement doesn't exceed limit
    → update row (find the matching entry row, patch its content)
    → return { success, entries, usage, entry_count, message }

  removeEntry(userId, target, oldText)
    → internalMutation
    → trim oldText, reject empty
    → re-read entries
    → substring match
    → same disambiguation as replace
    → delete matching row
    → return { success, entries, usage, entry_count, message }

  getCharCount(userId, target)
    → internalQuery
    → returns number (sum of all entry contents + delimiters)

  clearAllEntries(userId)
    → internalMutation
    → delete all memoryEntries where userId matches
    → called by nukeUserData

  _calculateUsage(entries, charLimit)
    → helper: returns { entries, usage: "45% — 990/2,200 chars", entry_count }

  _entriesCharCount(entries)
    → helper: ENTRY_DELIMITER.join(entries).length

Constants:
  MEMORY_CHAR_LIMIT = 2200
  USER_CHAR_LIMIT = 1375
  ENTRY_DELIMITER = "\n§\n"
```

#### `convex/memory/security.ts` (new)
```
Functions:
  scanContent(content: string): string | null
    → returns error string if blocked, null if clean
    → checks for invisible unicode characters
    → checks for threat patterns (regex list from Hermes)

Constants:
  THREAT_PATTERNS — array of [regex, id] tuples:
    - r'ignore\s+(previous|all|above|prior)\s+instructions' → "prompt_injection"
    - r'you\s+are\s+now\s+' → "role_hijack"
    - r'do\s+not\s+tell\s+the\s+user' → "deception_hide"
    - r'system\s+prompt\s+override' → "sys_prompt_override"
    - r'disregard\s+(your|all|any)\s+(instructions|rules|guidelines)' → "disregard_rules"
    - r'act\s+as\s+(if|though)\s+you\s+(have\s+no|don\'t\s+have)\s+(restrictions|limits|rules)' → "bypass_restrictions"
    - r'curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)' → "exfil_curl"
    - r'wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)' → "exfil_wget"
    - r'cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)' → "read_secrets"
    - r'authorized_keys' → "ssh_backdoor"
    - r'\$HOME/\.ssh|\~/\.ssh' → "ssh_access"
    - r'\$HOME/\.hermes/\.env|\~/\.hermes/\.env' → "hermes_env"
    (adapt the hermes_env pattern to your project's env path if needed)

  INVISIBLE_CHARS — set of unicode chars:
    '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e'
```

#### `convex/memory/tool.ts` (new)
```
The memory tool — a createTool instance.

export const memory = createTool({
  description: `Save durable information to persistent memory that survives across
    sessions. Memory is injected into future turns, so keep it compact and focused on
    facts that will still matter later.

    WHEN TO SAVE (do this proactively, don't wait to be asked):
    - User corrects you or says 'remember this' / 'don't do that again'
    - User shares a preference, habit, or personal detail
    - You discover something about the environment
    - You learn a convention, API quirk, or workflow specific to this user's setup
    - You identify a stable fact that will be useful again later

    PRIORITY: User preferences and corrections > environment facts > procedural knowledge.
    The most valuable memory prevents the user from having to repeat themselves.

    Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO
    state to memory.

    TWO TARGETS:
    - 'user': who the user is — name, role, preferences, communication style, pet peeves
    - 'memory': your notes — environment facts, project conventions, tool quirks, lessons learned

    ACTIONS: add (new entry), replace (update existing — old_text identifies it),
    remove (delete — old_text identifies it).

    SKIP: trivial/obvious info, things easily re-discovered, raw data dumps, temporary state.`,

  inputSchema: z.object({
    action: z.enum(["add", "replace", "remove"]).describe("The action to perform."),
    target: z.enum(["memory", "user"]).describe(
      "Which memory store: 'memory' for personal notes, 'user' for user profile."
    ),
    content: z.string().optional().describe(
      "The entry content. Required for 'add' and 'replace'."
    ),
    old_text: z.string().optional().describe(
      "Short unique substring identifying the entry to replace or remove."
    ),
  }),

  execute: async (ctx, args): Promise<string> => {
    const userId = ctx.userId;
    if (!userId) return JSON.stringify({ success: false, error: "No userId available." });

    if (args.action === "add") {
      if (!args.content) return JSON.stringify({ success: false, error: "content required for add" });
      return await ctx.runMutation(internal.memory.db.addEntry, {
        userId, target: args.target, content: args.content,
      });
    } else if (args.action === "replace") {
      if (!args.old_text) return JSON.stringify({ success: false, error: "old_text required for replace" });
      if (!args.content) return JSON.stringify({ success: false, error: "content required for replace" });
      return await ctx.runMutation(internal.memory.db.replaceEntry, {
        userId, target: args.target, oldText: args.old_text, newContent: args.content,
      });
    } else if (args.action === "remove") {
      if (!args.old_text) return JSON.stringify({ success: false, error: "old_text required for remove" });
      return await ctx.runMutation(internal.memory.db.removeEntry, {
        userId, target: args.target, oldText: args.old_text,
      });
    }
    return JSON.stringify({ success: false, error: `Unknown action: ${args.action}` });
  },
});
```

**Note on return type:** The mutation functions return JSON strings directly (matching
Hermes pattern). The `execute` handler passes them through. This means the mutations
must `return JSON.stringify(...)` not return objects.

#### `convex/memory/compaction.ts` (new)
```
Functions:

  compactMemory — internalAction
    args: { threadId: v.string() }
    handler:
      1. Fetch all messages from thread via
         ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
           threadId, order: "asc", statuses: ["success"],
           paginationOpts: { numItems: 1000, cursor: null },
         })
      2. Protect head (3 messages) and tail (10 messages)
      3. If middle is empty → return
      4. Serialize middle: "[role]: content" format
      5. Fetch existing thread summary via
         ctx.runQuery(components.agent.threads.getThread, { threadId })
      6. Build prompt:
         - If existing summary → "Update this summary with new info:
           [existing summary]
           New conversation:
           [middle text]"
         - If no summary → "Summarize this conversation:
           [middle text]"
         - Prompt should include sections: Key Decisions, Tasks Completed,
           In Progress, User Preferences, Important Context, Next Steps
         - Prompt should say: "Do NOT include facts already saved in memory
           entries — focus on conversation-specific context."
      7. Call LLM via resolveLanguageModel
      8. Store summary via
         ctx.runMutation(components.agent.threads.updateThread, {
           threadId, patch: { summary },
         })
      9. NOTE: We do NOT delete middle messages. contextHandler filters them out
         when a summary exists.

  memoryFlush — internalAction
    args: { threadId: v.string(), telegramChatId: v.string() }
    handler:
      1. Fetch recent messages (last 20) from thread
      2. Build flush prompt:
         "Review the conversation below and save anything worth remembering
         using the memory tool. Focus on: user preferences, corrections,
         environment facts, project conventions, decisions made.
         Skip: task progress, session outcomes, temporary state.
         If nothing worth saving, respond with 'Nothing to save.'"
      3. Call LLM with ONLY the memory tool available
         (pass tools: { memory } in generateText options)
      4. The LLM will call memory(action: "add", ...) to save facts
      5. Return (flush is fire-and-forget from the caller's perspective)
      6. QUIRK: This uses the Convex agent's generateText directly with a
         limited tool set. Need to verify this works with the v6 API —
         may need to create a temporary Agent instance with only the memory tool.

  extractTextContent — helper
    args: message object
    returns: string
    - if message.content is string → return it
    - if message.content is array → filter for type==="text", join with space
    - fallback: ""
```

**Memory flush quirk:** Hermes runs a separate AIAgent fork with only the memory tool
available. In Convex, we can't easily fork the agent. Options:
1. Create a mini `generateText` call with just the memory tool schema
2. Or skip the flush and rely on the nudge loop

I recommend option 1 if feasible — it's an important information preservation mechanism.
If the Convex agent API doesn't support passing a subset of tools to `generateText`,
we can manually call `generateText` with a prompt that asks the LLM to output
`memory` tool calls in JSON format, then parse and execute them. Ugly but works.

**Simpler alternative:** The flush can just be an LLM call that returns facts as text,
and we add them directly via `addEntry` without going through the tool. The flush prompt
would say "Output each fact as a separate line" and we'd split and add them.

#### `convex/memory/index.ts` (replace entirely)
```
Re-export from:
  export { memory } from "./tool";
  export * as db from "./db";
  export * as security from "./security";
  export { compactMemory, memoryFlush } from "./compaction";
```

### MODIFIED files

#### `convex/schema.ts`
- Remove `observationalMemory` table
- Add `memoryEntries` table with `by_user_and_target` index
- Bump schema version (if using one) or note this is a breaking change requiring `npx convex dev` to push

#### `convex/agent/instance.ts`
Changes to `unifiedContextHandler`:

```typescript
export const unifiedContextHandler: ContextHandler = async (ctx, args) => {
  const { threadId, userId, allMessages, recent } = args;
  if (!threadId) return allMessages;

  // Use userId from args if available, otherwise look it up
  const effectiveUserId = userId || /* fallback lookup from threadId */;

  // Parallel fetch
  const [memoryEntries, userEntries, threadDoc, sessions, tasks, files] = await Promise.all([
    ctx.runQuery(internal.memory.db.getEntries, {
      userId: effectiveUserId, target: "memory",
    }),
    ctx.runQuery(internal.memory.db.getEntries, {
      userId: effectiveUserId, target: "user",
    }),
    // Fetch thread doc for compaction summary
    ctx.runQuery(components.agent.threads.getThread, { threadId }).catch(() => null),
    ctx.runQuery(internal.sessions.db.getAllSessions, {}),
    ctx.runQuery(internal.tasks.listTasksForThread, { threadId }),
    ctx.runQuery(internal.files.db.getThreadFiles, { threadId }),
  ]);

  const contextMessages: Array<{ role: "user"; content: string }> = [];

  // 1. Compaction summary (if thread has been compacted)
  if (threadDoc?.summary) {
    contextMessages.push({
      role: "user",
      content: `### CONVERSATION SUMMARY (earlier turns were compacted)\n${threadDoc.summary}`,
    });
  }

  // 2. Memory entries (agent's personal notes)
  if (memoryEntries.length > 0) {
    const content = memoryEntries.map((e: any) => e.content).join("\n§\n");
    const pct = Math.min(100, Math.round((content.length / 2200) * 100));
    contextMessages.push({
      role: "user",
      content: `### MEMORY (your personal notes) [${pct}% — ${content.length}/2,200 chars]\n${content}`,
    });
  }

  // 3. User profile entries
  if (userEntries.length > 0) {
    const content = userEntries.map((e: any) => e.content).join("\n§\n");
    const pct = Math.min(100, Math.round((content.length / 1375) * 100));
    contextMessages.push({
      role: "user",
      content: `### USER PROFILE (who the user is) [${pct}% — ${content.length}/1,375 chars]\n${content}`,
    });
  }

  // 4. My list (sessions) — unchanged
  // 5. Tasks — unchanged
  // 6. Inbox (files) — unchanged
  // 7. Slow tools — unchanged

  // 8. Memory nudge (in-memory counter, reset on cold start)
  if (_memory_turns_since_nudge >= 10) {
    _memory_turns_since_nudge = 0;
    contextMessages.push({
      role: "user",
      content: `[System: Review the conversation. Have you learned anything worth saving? Use the memory tool to add/update entries. Focus on: user preferences, corrections, environment facts, project conventions, decisions made. Skip: task progress, session outcomes, temporary state.]`,
    });
  }

  // Use `recent` (unfiltered) + search results, NOT filtered allMessages
  return [...(args.search || []), ...recent, ...contextMessages, ...args.inputMessages, ...args.inputPrompt, ...args.existingResponses];
};
```

**Nudge counter:** Add at module level:
```typescript
let _memory_turns_since_nudge = 0;
// Increment after each contextHandler call
```

**contextOptions:** The agent definition needs updated contextOptions:
```typescript
contextOptions: {
  recentMessages: 50,         // last 50 messages (was implicit 100)
  excludeToolMessages: true,  // keep tool results out of recent
  searchOptions: {
    textSearch: true,         // enable text search
    vectorSearch: false,      // no vector search
    limit: 5,
    messageRange: { before: 1, after: 1 },
  },
  searchOtherThreads: true,   // search across all user threads
},
```

Agent definition changes:
```typescript
export const julesAgent = new Agent(components.agent, {
  name: "Jules Dispatch",
  languageModel: (() => { throw new Error("..."); }) as any,
  instructions: systemInstructions,
  contextHandler: unifiedContextHandler,
  contextOptions: { /* as above */ },
  maxSteps: 50,
  tools: {
    // ... existing tools ...
    memory: tools.memory,  // ADD THIS
  },
});
```

#### `convex/api/telegram.ts`
Command changes:

```
/new  → same behavior as current, but simplified:
        - create new thread (no handover summary needed — memory is per-user)
        - delete old thread's files
        - delete old thread
        - memory entries survive automatically (keyed by userId, not threadId)
        - message: "🆕 Starting fresh! Our conversation is reset, but I still remember everything important."

/reset → NEW command (what Hermes calls /reset):
         - clear conversation only, keep memory
         - cycle thread (create new, delete old)
         - keep files
         - keep memory entries
         - keep tasks
         - message: "🔄 Conversation cleared. I still have my notes and your files."

/nuke → renamed from current /reset:
        - confirmation button: "Yes, nuke everything"
        - callback: nuke_confirm
        - deletes: threads, memory entries, files, tasks, sessions, session outputs
        - keeps: provider config, API keys
        - message: "☢️ Nuking all data..."

/compact → trigger compaction:
           - message: "🧹 Compacting conversation..."
           - schedule memoryFlush first (save facts before compressing)
           - then schedule compactMemory
           - message: "✅ Conversation compacted."
```

#### `convex/users/db.ts`
Changes to `cycleUserThread`:
```typescript
export const cycleUserThread = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = /* lookup */;
    const oldThreadId = user.threadId;

    // Create new thread WITH userId for searchOtherThreads support
    const newThreadId = await createThread(ctx, components.agent, {
      userId: args.telegramChatId,
      title: "Chat",
    });

    // Update user record
    await ctx.db.patch(user._id, {
      threadId: newThreadId,
      isAgentRunning: false,
      pendingMessageText: undefined,
    });

    // NO memory handling needed — memory entries are keyed by userId, not threadId
    return { oldThreadId, newThreadId };
  },
});
```

Changes to `nukeUserData`:
```typescript
export const nukeUserData = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    // ... existing cleanup code ...

    // Replace observationalMemory deletion with memoryEntries deletion
    const allMemoryEntries = await ctx.db.query("memoryEntries").collect();
    for (const m of allMemoryEntries) {
      if (m.userId === args.telegramChatId) {
        await ctx.db.delete(m._id);
      }
    }

    // ... rest of cleanup ...
  },
});
```

**Note:** Since this is a single-user setup, we can simplify by deleting ALL memoryEntries
without checking userId (same pattern as tasks/sessions).

#### `convex/users/actions.ts`
Changes to `cycleThreadAction`:
```typescript
export const cycleThreadAction = internalAction({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    // 1. Cycle thread (no handover summary needed)
    const ids = await ctx.runMutation(internal.users.db.cycleUserThread, {
      telegramChatId: args.telegramChatId,
    });
    if (!ids) return;

    // 2. Cleanup old files
    const storageIds = await ctx.runMutation(internal.files.db.deleteFilesForThread, {
      threadId: ids.oldThreadId,
    });
    for (const sid of storageIds) {
      await ctx.storage.delete(sid);
    }

    // 3. Delete old thread
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: ids.oldThreadId,
    });

    return ids.newThreadId;
  },
});
```

Remove handover summary generation entirely — memory is per-user and persists.

---

## Implementation Order

### Phase 1: Foundation (schema + DB + security)
1. Edit `convex/schema.ts` — remove `observationalMemory`, add `memoryEntries`
2. Create `convex/memory/security.ts` — injection/exfil scanning
3. Create `convex/memory/db.ts` — CRUD functions with char limits
4. Create `convex/memory/index.ts` — barrel exports
5. Run `npx convex dev` — push schema, verify no errors

### Phase 2: Memory tool
6. Create `convex/memory/tool.ts` — `createTool` with add/replace/remove
7. Edit `convex/agent/instance.ts` — add `memory` to tools object

### Phase 3: Context handler rewrite
8. Edit `convex/agent/instance.ts` — rewrite `unifiedContextHandler`:
   - Fetch memory entries + user entries
   - Read thread summary, inject if exists
   - Add nudge logic
   - Use `recent` + `search` instead of filtered `allMessages`
   - Add `contextOptions` with `searchOtherThreads: true` (text only)
9. Increment nudge counter in contextHandler

### Phase 4: Compaction
10. Create `convex/memory/compaction.ts` — `compactMemory` + `memoryFlush`
11. Test compaction: verify summary stored in `thread.summary`, injected on next turn
12. Test memory flush: verify facts saved before compression

### Phase 5: Telegram commands
13. Edit `convex/api/telegram.ts`:
    - `/compact` → schedule memoryFlush then compactMemory
    - `/new` → simplified cycle (no handover)
    - `/reset` → clear convo, keep memory
    - `/nuke` → nuke everything (renamed from /reset)
14. Edit `/help` text to reflect new commands

### Phase 6: Cleanup
15. Edit `convex/users/db.ts` — update `cycleUserThread` and `nukeUserData`
16. Edit `convex/users/actions.ts` — remove handover logic from `cycleThreadAction`
17. Delete `convex/memory/instructions.ts`
18. Delete `convex/memory/processor.ts`
19. Update `AGENT.md` — document new memory system
20. Update `README.md` — reflect new commands

### Phase 7: Verify
21. Run `npx convex dev` — ensure no type errors
22. Test `/new` — verify memory persists, thread resets
23. Test `/reset` — verify convo clears, memory stays
24. Test `/nuke` — verify everything wiped
25. Test `/compact` — verify summary appears in next context
26. Test memory tool — add, replace, remove entries
27. Test nudge — verify fires after 10 turns
28. Test searchOtherThreads — verify old thread messages appear in search

---

## Context Handler Message Order (Final)

```
1. search results (from searchOtherThreads text search)
2. recent messages (last 50, unfiltered)
3. CONVERSATION SUMMARY (if thread.summary exists)
4. MEMORY (agent's personal notes) [usage%]
5. USER PROFILE (who the user is) [usage%]
6. MY LIST (tracked sessions)
7. CURRENT PROJECT todo/task LISTS
8. INBOX (unregistered files)
9. SLOW TOOLS instructions
10. [Nudge prompt every 10 turns — "review and save to memory"]
11. inputMessages (from generateText call)
12. inputPrompt (the current user message)
13. existingResponses (if any)
```

---

## Data Flow Summary

```
User sends message on Telegram
  → processTelegramUpdate
    → queueMessage → processMessageQueue
      → julesAgent.generateText(ctx, { threadId }, { prompt })
        → contextHandler fires
          → parallel fetch: memory entries, user entries, thread summary, sessions, tasks, files
          → build context: [search, recent, summary?, memory?, user?, sessions, tasks, files, nudge?]
          → return context messages
        → LLM sees tools: { memory, message_user, create_session, ... }
        → LLM may call memory(action: "add", target: "memory", content: "...")
          → execute handler: ctx.runMutation(internal.memory.db.addEntry, { userId, target, content })
          → scan content → check limit → insert → return JSON with usage%
        → LLM calls message_user to respond
      → response sent to Telegram

User sends /compact
  → schedule memoryFlush(threadId, telegramChatId)
    → LLM reviews recent messages, calls memory tool to save facts
  → schedule compactMemory(threadId)
    → LLM summarizes middle messages, stores in thread.summary
  → next contextHandler call reads thread.summary and injects it

User sends /new
  → cycleThreadAction
    → create new thread with userId
    → delete old thread + files
    → memory entries untouched (keyed by userId)
  → next message uses new thread, memory loads from DB normally

User sends /reset
  → create new thread
  → delete old thread + files
  → memory entries + tasks untouched

User sends /nuke (was /reset)
  → confirmation button
  → nukeUserData: delete all tasks, sessions, memory entries, files
  → create new thread
  → fresh start
```

import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import { createThread } from "@convex-dev/agent";

export const getOrCreateUserThread = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", telegramChatId))
      .first();

    if (user) {
      return user.threadId;
    }

    const threadId = await createThread(ctx, components.agent, { userId: telegramChatId });
    await ctx.db.insert("users", {
      telegramChatId,
      threadId: threadId,
    });
    return threadId;
  }
});

export const clearUserThread = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", telegramChatId))
      .first();

    if (user) {
      const threadId = await createThread(ctx, components.agent, { userId: telegramChatId });
      await ctx.db.patch(user._id, { threadId: threadId });
      return true;
    }
    return false;
  }
});

export const getChatIdForThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    let user = await ctx.db.query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
      .first();
    if (!user) {
      user = await ctx.db.query("users").first();
    }
    return user?.telegramChatId;
  }
});

export const getAnyExistingUser = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.query("users").first();
    return user ? { telegramChatId: user.telegramChatId } : null;
  },
});

export const createAuthSession = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const token = "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        parseInt(c, 10) ^
        (crypto.getRandomValues(new Uint8Array(1))[0] ?? 0) & (15 >> (parseInt(c, 10) / 4))
      ).toString(16)
    );
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24; // 24 hours

    await ctx.db.insert("authSessions", {
      token,
      telegramChatId: args.telegramChatId,
      expiresAt,
    });

    return token;
  },
});

export const validateAuthSession = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    return session.telegramChatId;
  },
});

export const consumeAuthSession = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!session || session.expiresAt < Date.now()) {
      return null;
    }

    await ctx.db.delete(session._id);
    return session.telegramChatId;
  },
});

/**
 * Cycle the thread for a user.
 * Memory entries are keyed by userId (not threadId), so they persist automatically.
 */
export const cycleUserThread = internalMutation({
  args: { telegramChatId: v.string() },
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
      consecutiveFailures: 0,
    });

    // Memory entries are keyed by userId, not threadId — nothing to move
    // Thread summaries stay with old thread (it's history)

    return { oldThreadId, newThreadId };
  },
});

/**
 * Completely wipe all data for a user except their providerConfig.
 * Deletes ALL data from tasks, julesSessions, sessionOutputs, memoryEntries, threadSummaries, and uploadedFiles.
 */
export const nukeUserData = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();

    if (!user) return;

    // We'll return IDs to be deleted from storage/external via an action later
    const oldThreadId = user.threadId;

    // 1. Delete ALL tasks (single-user setup - delete everything)
    const allTasks = await ctx.db.query("tasks").collect();
    for (const t of allTasks) await ctx.db.delete(t._id);

    // 2. Delete ALL julesSessions and collect their IDs for sessionOutputs cleanup
    const allSessions = await ctx.db.query("julesSessions").collect();
    const sessionIds = allSessions.map(s => s.julesSessionId);
    for (const s of allSessions) await ctx.db.delete(s._id);

    // 3. Delete ALL sessionOutputs for the deleted sessions
    const allSessionOutputs = await ctx.db.query("sessionOutputs").collect();
    for (const so of allSessionOutputs) {
      if (sessionIds.includes(so.julesSessionId)) {
        await ctx.db.delete(so._id);
      }
    }

    // 4. Delete ALL memoryEntries (single-user setup)
    const allMemoryEntries = await ctx.db.query("memoryEntries").collect();
    for (const m of allMemoryEntries) await ctx.db.delete(m._id);

    // 4b. Delete ALL threadSummaries
    const allSummaries = await ctx.db.query("threadSummaries").collect();
    for (const s of allSummaries) await ctx.db.delete(s._id);

    // Note: uploadedFiles are deleted by deleteAllFiles in the action
    // so storage can also be cleaned up

    // 5. Delete all messages in the old thread from the agent component
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: oldThreadId,
    });

    // 6. Cycle thread
    const newThreadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });
    await ctx.db.patch(user._id, {
      threadId: newThreadId,
      isAgentRunning: false,
      pendingMessageText: undefined,
      memoryNudgeCount: 0,
      consecutiveFailures: 0,
    });

    return oldThreadId;
  }
});

export const getAllUsersForUpdates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter(u => u.updateNotificationsEnabled === true)
      .map(u => ({
        telegramChatId: u.telegramChatId,
        lastNotifiedVersion: u.lastNotifiedVersion,
      }));
  },
});

export const markNotifiedVersion = internalMutation({
  args: {
    telegramChatId: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();

    if (user) {
      await ctx.db.patch(user._id, { lastNotifiedVersion: args.version });
    }
  },
});

export const updateNotificationPreference = internalMutation({
  args: {
    telegramChatId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();

    if (user) {
      await ctx.db.patch(user._id, { updateNotificationsEnabled: args.enabled });
    }
  },
});

export const getUserNotificationPreference = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();
    return user?.updateNotificationsEnabled ?? false;
  },
});

// --- Existing User State Management ---

export const updateLastSearchingSent = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { lastSearchingSentAt: Date.now() });
    }
  }
});

export const getLastSearchingSent = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", args.telegramChatId))
      .first();
    return user?.lastSearchingSentAt;
  }
});

export const appendPendingMessage = internalMutation({
  args: { threadId: v.string(), text: v.string() },
  handler: async (ctx, { threadId, text }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    if (!user) return;

    // 1. Save to agent history immediately (Mutation context)
    // This ensures the action snapshot starting later will see it.
    await ctx.runMutation(components.agent.messages.addMessages, {
      threadId,
      messages: [
        {
          message: { role: "user" as const, content: text },
        },
      ],
    });

    // 2. Add to pending queue for batching/processing
    const current = user.pendingMessageText || "";
    const separator = current ? "\n" : "";
    await ctx.db.patch(user._id, {
      pendingMessageText: current + separator + text,
    });
  },
});


/**
 * Prepend message to pending queue (puts it first, before existing messages).
 * Used for re-queueing failed messages so they get processed before new user messages.
 */
export const prependPendingMessage = internalMutation({
  args: { threadId: v.string(), text: v.string() },
  handler: async (ctx, { threadId, text }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    if (!user) return;
    const current = user.pendingMessageText || "";
    const separator = current ? "\n" : "";
    await ctx.db.patch(user._id, {
      pendingMessageText: text + separator + current,
    });
  },
});

const QUEUE_LOCK_TTL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Atomically acquire the queue processing lock.
 * Returns true if lock acquired, false if already locked (and not stale).
 * Stale locks (>3 min old) are claimed automatically.
 */
export const acquireQueueLock = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    
    if (!user) return false;
    
    const now = Date.now();
    const lockedAt = user.queueLockedAt;
    
    // If locked and not stale, someone else is processing
    if (lockedAt && (now - lockedAt) < QUEUE_LOCK_TTL_MS) {
      return false;
    }
    
    // Either not locked, or lock is stale - claim it
    await ctx.db.patch(user._id, { queueLockedAt: now });
    return true;
  },
});

/**
 * Release the queue processing lock.
 */
export const releaseQueueLock = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    
    if (user && user.queueLockedAt !== undefined) {
      await ctx.db.patch(user._id, { queueLockedAt: undefined });
    }
  },
});

export const getPendingMessages = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    return user?.pendingMessageText;
  }
});

export const healOrphanedToolCalls = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const msgResult: any = await ctx.runQuery(
      (components as any).agent.messages.listMessagesByThreadId,
      {
        threadId,
        order: "desc",
        statuses: ["success", "pending"],
        paginationOpts: { numItems: 50, cursor: null },
      },
    );

    const messages: any[] = msgResult?.page ?? [];
    if (messages.length === 0) return { healed: false };

    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const m of messages) {
      const msg = m.message;
      if (msg?.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCallIds.add(tc.id);
        }
      }
      if (msg?.role === "tool" && msg.tool_call_id) {
        toolResultIds.add(msg.tool_call_id);
      }
    }

    const orphanedIds = [...toolCallIds].filter((id) => !toolResultIds.has(id));
    if (orphanedIds.length === 0) return { healed: false };

    const syntheticToolResults = orphanedIds.map((id) => ({
      message: {
        role: "tool" as const,
        tool_call_id: id,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: id,
            output: { error: "Tool execution was interrupted. The result is unavailable." },
            isError: true,
          },
        ],
      },
    }));

    await ctx.runMutation(components.agent.messages.addMessages, {
      threadId,
      messages: syntheticToolResults as any,
    });

    return { healed: true, count: orphanedIds.length };
  },
});

export const clearPendingMessages = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { pendingMessageText: undefined });
    }
  }
});

/**
 * Atomically pop all pending messages for a thread.
 * Returns the messages and clears them in a single transaction.
 */
export const popPendingMessages = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    
    if (!user || !user.pendingMessageText) {
      return null;
    }
    
    const messages = user.pendingMessageText;
    
    // Atomically clear the pending messages
    await ctx.db.patch(user._id, { pendingMessageText: undefined });
    
    return messages;
  }
});

/**
 * Get the queue depth (number of pending messages) for a thread.
 */
export const getQueueDepth = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    
    if (!user || !user.pendingMessageText) {
      return 0;
    }
    
    // Count messages by splitting on newlines
    const messages = user.pendingMessageText
      .split("\n")
      .filter(m => m.trim() !== "");
    
    return messages.length;
  }
});

/**
 * Drop oldest messages, keeping only the newest N messages.
 * Used for queue capping when limit is reached.
 */
export const dropOldestMessages = internalMutation({
  args: { threadId: v.string(), keep: v.number() },
  handler: async (ctx, { threadId, keep }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    
    if (!user || !user.pendingMessageText) {
      return { dropped: 0, remaining: 0 };
    }
    
    const messages = user.pendingMessageText
      .split("\n")
      .filter(m => m.trim() !== "");
    
    if (messages.length <= keep) {
      return { dropped: 0, remaining: messages.length };
    }
    
    const dropped = messages.length - keep;
    const remainingMessages = messages.slice(-keep);
    
    await ctx.db.patch(user._id, {
      pendingMessageText: remainingMessages.join("\n")
    });
    
    return { dropped, remaining: keep };
  }
});

// DEPRECATED: isAgentRunning and setAgentRunning are no longer used
// The queue is now self-draining and doesn't need a running flag
export const setAgentRunning = internalMutation({
  args: { telegramChatId: v.string(), isRunning: v.boolean() },
  handler: async (ctx, { telegramChatId, isRunning }) => {
    // No-op - kept for backward compatibility
    console.log("[DEPRECATED] setAgentRunning called - no longer needed");
  }
});

export const isAgentRunning = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    // Always return false - queue is self-draining
    return false;
  }
});

export const incrementConsecutiveFailures = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    if (user) {
      const current = user.consecutiveFailures ?? 0;
      await ctx.db.patch(user._id, { consecutiveFailures: current + 1 });
      return current + 1;
    }
    return 1;
  },
});

export const resetConsecutiveFailures = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, { telegramChatId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", q => q.eq("telegramChatId", telegramChatId))
      .first();
    if (user && user.consecutiveFailures !== 0) {
      await ctx.db.patch(user._id, { consecutiveFailures: 0 });
    }
  },
});



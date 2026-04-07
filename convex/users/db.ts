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
    const user = await ctx.db.query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
      .first();
    return user?.telegramChatId;
  }
});

export const getProviderConfig = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();
    return {
      config: user?.providerConfig || null,
      julesApiKey: user?.julesApiKey,
      exaApiKey: user?.exaApiKey,
    };
  },
});

export const getAnyExistingUser = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db.query("users").first();
    return user ? { telegramChatId: user.telegramChatId } : null;
  },
});

export const getProviderConfigByThreadId = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .first();
    if (!user) return null;
    return {
      telegramChatId: user.telegramChatId,
      providerConfig: user.providerConfig || null,
      julesApiKey: user.julesApiKey,
      exaApiKey: user.exaApiKey,
    };
  },
});

export const updateJulesApiKey = internalMutation({
  args: { telegramChatId: v.string(), apiKey: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { julesApiKey: args.apiKey });
    }
  },
});

export const updateExaApiKey = internalMutation({
  args: { telegramChatId: v.string(), apiKey: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { exaApiKey: args.apiKey });
    }
  },
});

export const updateProviderConfig = internalMutation({
  args: {
    telegramChatId: v.string(),
    endpoint: v.string(),
    model: v.string(),
    apiKey: v.string(),
    sdkType: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openai-compatible"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();

    const config = {
      endpoint: args.endpoint,
      model: args.model,
      apiKey: args.apiKey,
      sdkType: args.sdkType,
    };

    if (user) {
      await ctx.db.patch(user._id, { providerConfig: config });
      
      // Auto-recovery: If there are pending messages, trigger the queue
      if (user.pendingMessageText) {
        await ctx.scheduler.runAfter(0, internal.api.telegram.sendChatMessage, {
          chatId: args.telegramChatId,
          message: "🔄 <b>Settings Updated!</b> Resuming your last request...",
        });
        await ctx.scheduler.runAfter(0, internal.api.telegram.processMessageQueue, {
          threadId: user.threadId,
          telegramChatId: args.telegramChatId,
        });
      }
    } else {
      const threadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });
      await ctx.db.insert("users", {
        telegramChatId: args.telegramChatId,
        threadId,
        providerConfig: config,
      });
    }
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
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
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
    const current = user.pendingMessageText || "";
    const separator = current ? "\n" : "";
    await ctx.db.patch(user._id, {
      pendingMessageText: current + separator + text,
    });
  },
});

export const getPendingMessages = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    return user?.pendingMessageText || "";
  },
});

export const clearPendingMessages = internalMutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { pendingMessageText: undefined });
    }
  },
});

export const setAgentRunning = internalMutation({
  args: { threadId: v.string(), isRunning: v.boolean() },
  handler: async (ctx, { threadId, isRunning }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", threadId))
      .first();
    if (user) {
      await ctx.db.patch(user._id, { isAgentRunning: isRunning });
    }
  },
});

export const isAgentRunning = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_threadId", q => q.eq("threadId", args.threadId))
      .first();
    return user?.isAgentRunning ?? false;
  },
});

export const seedFromInitial = internalMutation({
  args: {
    telegramChatId: v.string(),
    julesApiKey: v.string(),
    exaApiKey: v.optional(v.string()),
    llmEndpoint: v.string(),
    llmModel: v.string(),
    llmApiKey: v.string(),
    llmSdkType: v.union(
      v.literal("openai"),
      v.literal("anthropic"),
      v.literal("google"),
      v.literal("openai-compatible"),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .first();

    if (existing) {
      return existing._id;
    }

    const threadId = await createThread(ctx, components.agent, { userId: args.telegramChatId });
    await ctx.db.insert("users", {
      telegramChatId: args.telegramChatId,
      threadId,
      julesApiKey: args.julesApiKey,
      exaApiKey: args.exaApiKey,
      providerConfig: {
        endpoint: args.llmEndpoint,
        model: args.llmModel,
        apiKey: args.llmApiKey,
        sdkType: args.llmSdkType,
      },
    });
    return threadId;
  },
});

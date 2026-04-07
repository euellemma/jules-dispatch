import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";

const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;
const ENTRY_DELIMITER = "\n\u00a7\n";

function charLimit(target: string): number {
  return target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
}

// --- Security scanning ---

const THREAT_PATTERNS: [RegExp, string][] = [
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, "prompt_injection"],
  [/you\s+are\s+now\s+/i, "role_hijack"],
  [/do\s+not\s+tell\s+the\s+user/i, "deception_hide"],
  [/system\s+prompt\s+override/i, "sys_prompt_override"],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, "disregard_rules"],
  [/act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, "bypass_restrictions"],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_curl"],
  [/wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_wget"],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, "read_secrets"],
  [/authorized_keys/i, "ssh_backdoor"],
  [/\$HOME\/\.ssh|~\/\.ssh/i, "ssh_access"],
  [/\$HOME\/\.hermes\/\.env|~\/\.hermes\/\.env/i, "hermes_env"],
];

const INVISIBLE_CHARS = new Set([
  "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff",
  "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
]);

function scanMemoryContent(content: string): string | null {
  for (const char of INVISIBLE_CHARS) {
    if (content.includes(char)) {
      return `Blocked: content contains invisible unicode character U+${char.charCodeAt(0).toString(16).padStart(4, "0")} (possible injection).`;
    }
  }
  for (const [pattern, id] of THREAT_PATTERNS) {
    if (pattern.test(content)) {
      return `Blocked: content matches threat pattern '${id}'. Memory entries are injected into context and must not contain injection or exfiltration payloads.`;
    }
  }
  return null;
}

// --- Helpers ---

function joinEntries(entries: string[]): string {
  return entries.join(ENTRY_DELIMITER);
}

function successResponse(entries: string[], target: string, message?: string) {
  const limit = charLimit(target);
  const current = entries.length > 0 ? joinEntries(entries).length : 0;
  const pct = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
  const resp: Record<string, unknown> = {
    success: true,
    target,
    entries,
    usage: `${pct}% \u2014 ${current.toLocaleString()}/${limit.toLocaleString()} chars`,
    entryCount: entries.length,
  };
  if (message) resp.message = message;
  return resp;
}

// --- Memory entry queries ---

export const getEntries = internalQuery({
  args: {
    userId: v.string(),
    target: v.union(v.literal("memory"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("memoryEntries")
      .withIndex("by_user_and_target", (q) =>
        q.eq("userId", args.userId).eq("target", args.target))
      .order("asc")
      .collect();
  },
});

export const getCharCount = internalQuery({
  args: {
    userId: v.string(),
    target: v.union(v.literal("memory"), v.literal("user")),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("memoryEntries")
      .withIndex("by_user_and_target", (q) =>
        q.eq("userId", args.userId).eq("target", args.target))
      .collect();
    const contents = entries.map(e => e.content);
    return contents.length > 0 ? joinEntries(contents).length : 0;
  },
});

export const addEntry = internalMutation({
  args: {
    userId: v.string(),
    target: v.union(v.literal("memory"), v.literal("user")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const content = args.content.trim();
    if (!content) return { success: false, error: "Content cannot be empty." };

    const scanError = scanMemoryContent(content);
    if (scanError) return { success: false, error: scanError };

    const entries = await ctx.db
      .query("memoryEntries")
      .withIndex("by_user_and_target", (q) =>
        q.eq("userId", args.userId).eq("target", args.target))
      .collect();

    if (entries.some(e => e.content === content)) {
      return successResponse(entries.map(e => e.content), args.target, "Entry already exists (no duplicate added).");
    }

    const existingContents = entries.map(e => e.content);
    const newAll = [...existingContents, content];
    const totalChars = joinEntries(newAll).length;
    const limit = charLimit(args.target);

    if (totalChars > limit) {
      const current = existingContents.length > 0
        ? joinEntries(existingContents).length : 0;
      return {
        success: false,
        error: `Memory at ${current.toLocaleString()}/${limit.toLocaleString()} chars. Adding this entry (${content.length} chars) would exceed the limit. Replace or remove existing entries first.`,
        currentEntries: existingContents,
        usage: `${current.toLocaleString()}/${limit.toLocaleString()}`,
      };
    }

    await ctx.db.insert("memoryEntries", {
      userId: args.userId,
      target: args.target,
      content,
      createdAt: Date.now(),
    });

    return successResponse(newAll, args.target, "Entry added.");
  },
});

export const replaceEntry = internalMutation({
  args: {
    userId: v.string(),
    target: v.union(v.literal("memory"), v.literal("user")),
    oldText: v.string(),
    newContent: v.string(),
  },
  handler: async (ctx, args) => {
    const oldText = args.oldText.trim();
    const newContent = args.newContent.trim();

    if (!oldText) return { success: false, error: "oldText cannot be empty." };
    if (!newContent) return { success: false, error: "newContent cannot be empty. Use 'remove' to delete." };

    const scanError = scanMemoryContent(newContent);
    if (scanError) return { success: false, error: scanError };

    const entries = await ctx.db
      .query("memoryEntries")
      .withIndex("by_user_and_target", (q) =>
        q.eq("userId", args.userId).eq("target", args.target))
      .collect();

    const matches = entries.filter(e => e.content.includes(oldText));

    if (matches.length === 0) {
      return { success: false, error: `No entry matched '${oldText}'.` };
    }

    if (matches.length > 1) {
      const uniqueTexts = new Set(matches.map(e => e.content));
      if (uniqueTexts.size > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Be more specific.`,
          matches: matches.map(e => e.content.slice(0, 80) + (e.content.length > 80 ? "..." : "")),
        };
      }
    }

    const testContents = entries.map(e => e.content);
    const matchIdx = entries.findIndex(e => e.content.includes(oldText));
    const match = entries[matchIdx]!;
    testContents[matchIdx] = newContent;
    const totalChars = joinEntries(testContents).length;
    const limit = charLimit(args.target);

    if (totalChars > limit) {
      return {
        success: false,
        error: `Replacement would put memory at ${totalChars.toLocaleString()}/${limit.toLocaleString()} chars. Shorten the new content or remove other entries first.`,
      };
    }

    await ctx.db.patch(match._id, { content: newContent });
    return successResponse(testContents, args.target, "Entry replaced.");
  },
});

export const removeEntry = internalMutation({
  args: {
    userId: v.string(),
    target: v.union(v.literal("memory"), v.literal("user")),
    oldText: v.string(),
  },
  handler: async (ctx, args) => {
    const oldText = args.oldText.trim();
    if (!oldText) return { success: false, error: "oldText cannot be empty." };

    const entries = await ctx.db
      .query("memoryEntries")
      .withIndex("by_user_and_target", (q) =>
        q.eq("userId", args.userId).eq("target", args.target))
      .collect();

    const matches = entries.filter(e => e.content.includes(oldText));

    if (matches.length === 0) {
      return { success: false, error: `No entry matched '${oldText}'.` };
    }

    if (matches.length > 1) {
      const uniqueTexts = new Set(matches.map(e => e.content));
      if (uniqueTexts.size > 1) {
        return {
          success: false,
          error: `Multiple entries matched '${oldText}'. Be more specific.`,
          matches: matches.map(e => e.content.slice(0, 80) + (e.content.length > 80 ? "..." : "")),
        };
      }
    }

    const matchedIdx = entries.findIndex(e => e.content.includes(oldText));
    const matchedEntry = entries[matchedIdx]!;
    await ctx.db.delete(matchedEntry._id);
    const remaining = entries.filter(e => e._id !== matchedEntry._id).map(e => e.content);
    return successResponse(remaining, args.target, "Entry removed.");
  },
});

// --- Nudge counter ---

export const getNudgeCount = internalQuery({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();
    return user?.memoryNudgeCount ?? 0;
  },
});

export const incrementNudgeCounter = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();
    if (!user) return 0;
    const current = user.memoryNudgeCount ?? 0;
    const next = current + 1;
    await ctx.db.patch(user._id, { memoryNudgeCount: next });
    return next;
  },
});

export const resetNudgeCounter = internalMutation({
  args: { telegramChatId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_telegramChatId", (q) => q.eq("telegramChatId", args.telegramChatId))
      .unique();
    if (user) await ctx.db.patch(user._id, { memoryNudgeCount: 0 });
  },
});

// --- Thread summaries ---

export const getThreadSummary = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threadSummaries")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .first();
  },
});

export const upsertThreadSummary = internalMutation({
  args: {
    threadId: v.string(),
    summary: v.string(),
    summarizedUpToOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("threadSummaries")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const s of existing) await ctx.db.delete(s._id);

    await ctx.db.insert("threadSummaries", {
      threadId: args.threadId,
      summary: args.summary,
      summarizedUpToOrder: args.summarizedUpToOrder,
      createdAt: Date.now(),
    });
  },
});

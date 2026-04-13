"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { getJulesClient } from "../tools/nodeActions";
import { internal } from "../_generated/api";
import { withRetry } from "../utils/retry";

async function getUserIdForSession(ctx: any, sessionId: string): Promise<string | undefined> {
  const session = await ctx.runQuery(internal.sessions.db.getSessionByJulesId, { julesSessionId: sessionId });
  if (session?.threadId) {
    return await ctx.runQuery(internal.users.db.getChatIdForThread, { threadId: session.threadId });
  }
  return undefined;
}

export const createSession = internalAction({
  args: {
    threadId: v.optional(v.string()), // Added threadId
    prompt: v.string(),
    title: v.optional(v.string()),
    githubRepo: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    requireApproval: v.optional(v.boolean()),
    autoPr: v.optional(v.boolean()),
    prefs: v.optional(v.object({
      approval: v.union(v.literal("auto"), v.literal("confirm"), v.literal("strict")),
      verbosity: v.union(v.literal("silent"), v.literal("milestones"), v.literal("full")),
    })),
  },
  handler: async (ctx, args) => {
    try {
      // Get userId from threadId or fallback to any existing user
      let userId: string | undefined;
      if (args.threadId) {
        userId = await ctx.runQuery(internal.users.db.getChatIdForThread, { threadId: args.threadId });
      }
      if (!userId) {
        const user = await ctx.runQuery(internal.users.db.getAnyExistingUser);
        userId = user?.telegramChatId;
      }
      if (!userId) {
        throw new Error("No user configured");
      }

      const jules = await getJulesClient(ctx);
      const source = args.githubRepo && args.baseBranch ? {
        github: args.githubRepo,
        baseBranch: args.baseBranch
      } : undefined;

      const session = await withRetry(async () => {
        return await jules.session({
          prompt: args.prompt,
          title: args.title,
          source: source,
          requireApproval: args.requireApproval ?? true,
          autoPr: args.autoPr ?? false
        });
      }, {
        maxAttempts: 3,
        baseDelayMs: 2000,
        isRetriable: (e) => e?.status === 429 || e?.status >= 500 || String(e).includes("ECONNRESET"),
      });

      return { success: true, id: session.id };
    } catch (error: any) {
      console.error("Error creating Jules session:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
});

export const sendMessage = internalAction({
  args: { sessionId: v.string(), prompt: v.string() },
  handler: async (ctx, args) => {
    try {
      const userId = await getUserIdForSession(ctx, args.sessionId);
      const jules = await getJulesClient(ctx);
      await withRetry(async () => {
        const session = await jules.session(args.sessionId);
        await session.send(args.prompt);
      }, {
        maxAttempts: 3,
        baseDelayMs: 2000,
        isRetriable: (e) => e?.status === 429 || e?.status >= 500 || String(e).includes("ECONNRESET"),
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error sending message to Jules session:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
});

export const approvePlan = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    try {
      const userId = await getUserIdForSession(ctx, args.sessionId);
      const jules = await getJulesClient(ctx);
      await withRetry(async () => {
        const session = await jules.session(args.sessionId);
        await session.approve();
      }, {
        maxAttempts: 3,
        baseDelayMs: 2000,
        isRetriable: (e) => e?.status === 429 || e?.status >= 500 || String(e).includes("ECONNRESET"),
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error approving plan in Jules session:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
});

export const sendTelegramMessage = internalAction({
  args: { threadId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    try {
      const telegramChatId = await ctx.runQuery(internal.users.db.getChatIdForThread, {
        threadId: args.threadId
      });

      if (!telegramChatId) {
        return { success: false, error: "No Telegram Chat ID found for this thread." };
      }

      await ctx.runAction(internal.api.telegram.sendChatMessage, {
        chatId: telegramChatId,
        message: args.message,
      });
      return { success: true };
    } catch (error: any) {
      console.error("Error sending Telegram message:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
});

export const getSessionActivities = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    try {
      const userId = await getUserIdForSession(ctx, args.sessionId);
      const jules = await getJulesClient(ctx);
      const session = await jules.session(args.sessionId);
      const { activities: activitiesResult } = await session.activities.list({});
      
      const formattedLog = activitiesResult.map((act: any) => {
        const time = new Date(act.createTime).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' });
        const originator = act.originator ? `[${act.originator}]` : '';
        
        if (act.type === 'progressUpdated') {
          let entry = `[${time}] ${originator} Progress: ${act.title}`;
          if (act.description) entry += ` - ${act.description}`;
          if (act.artifacts && act.artifacts.length > 0) {
            const files = act.artifacts
              .filter((a: any) => a.type === 'changeSet')
              .map((a: any) => {
                if (a.parsed && a.parsed().files) {
                  return a.parsed().files.map((f: any) => f.path).join(', ');
                }
                return null;
              })
              .filter(Boolean)
              .join(', ');
            if (files) entry += ` | Files: ${files}`;
          }
          return entry;
        } else if (act.type === 'agentMessaged') {
          return `[${time}] ${originator} Agent: ${act.message}`;
        } else if (act.type === 'planGenerated') {
          let entry = `[${time}] ${originator} Plan: ${act.plan.title}`;
          if (act.plan?.steps && act.plan.steps.length > 0) {
            act.plan.steps.forEach((step: any) => {
              entry += `\n   ${step.index}. ${step.title}${step.description ? ': ' + step.description : ''}`;
            });
          }
          return entry;
        } else if (act.type === 'planApproved') {
          return `[${time}] ${originator} Plan Approved`;
        } else if (act.type === 'sessionCompleted') {
          return `[${time}] ${originator} Session Completed`;
        } else if (act.type === 'sessionFailed') {
          return `[${time}] ${originator} Session Failed: ${act.reason}`;
        } else if (act.type === 'userMessaged') {
          return `[${time}] ${originator} User: ${act.message}`;
        } else {
          return `[${time}] ${originator} ${act.type}: ${act.description || ''}`;
        }
      });
      return { success: true, activities: formattedLog.join('\n') };
    } catch (error: any) {
      console.error("Error getting session activities:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
});

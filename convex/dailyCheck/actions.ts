import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

export const runDailyChecks = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runAction(internal.updater.actions.checkForUpdates);
    await ctx.runMutation(internal.dailyCheck.actions.cleanupLlmCalls, {});
  },
});

export const cleanupLlmCalls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const allCalls = await ctx.db.query("llmCalls").take(1000);

    for (const call of allCalls) {
      if (call.timestamp < twoDaysAgo) {
        await ctx.db.delete(call._id);
      }
    }
  },
});
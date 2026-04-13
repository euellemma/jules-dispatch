import { createTool } from "@convex-dev/agent";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { z } from "zod";

export function createReportToOrchestratorTool(
  mainThreadId: string,
  sessionInfo: { julesSessionId: string; shortName?: string },
) {
  return createTool({
    description:
      "Report to the orchestrator. REQUIRED before finishing. Your ONLY output channel.",
    inputSchema: z.object({
      report: z
        .string()
        .describe(
          "What happened, what you did, what the orchestrator should know.",
        ),
    }),
    execute: async (ctx, args) => {
      const shortName =
        sessionInfo.shortName || sessionInfo.julesSessionId.slice(0, 8);

      await ctx.runMutation(internal.users.db.appendPendingMessage, {
        threadId: mainThreadId,
        text: `[SESSION REPORT: ${shortName}]\n${args.report}`,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.tools.reportToOrchestrator.wakeMainAgent,
        {
          mainThreadId,
        },
      );

      return "Report sent to orchestrator.";
    },
  });
}

export const wakeMainAgent = internalAction({
  args: { mainThreadId: v.string() },
  handler: async (ctx, args) => {
    // Self-draining queue: always trigger queue processing
    // The queue will handle deduplication naturally via atomic pop
    const chatId = await ctx.runQuery(
      internal.users.db.getChatIdForThread,
      { threadId: args.mainThreadId },
    );
    if (chatId) {
      await ctx.scheduler.runAfter(
        0,
        internal.api.telegram.processMessageQueue,
        {
          threadId: args.mainThreadId,
          telegramChatId: chatId,
        },
      );
    }
    // If no chatId, message stays in pendingMessageText.
    // It will be drained when the user next interacts (triggers processMessageQueue).
  },
});

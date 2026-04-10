"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { logger } from "../utils/logger";
import * as github from "./githubApi";

export const checkProvisionedBots = internalAction({
  args: {},
  handler: async (ctx) => {
    logger.info("[provisioning-poll] Checking provisioned bots");

    const bots = await ctx.runQuery(internal.provisioning.db.getBotsByStatus, {
      statuses: ["deploying", "provisioning"],
    });

    if (bots.length === 0) {
      return;
    }

    for (const bot of bots) {
      try {
        if (!bot.githubRepo) {
          logger.warn("[provisioning-poll] Bot has no githubRepo", { botId: bot._id, name: bot.name });
          continue;
        }

        const runs = await github.getWorkflowRuns(bot.githubRepo, "managed");

        if (runs.length === 0) {
          logger.info("[provisioning-poll] No workflow runs yet", { name: bot.name, repo: bot.githubRepo });

          const waitTime = Date.now() - bot.updatedAt;
          if (waitTime > 30 * 60 * 1000) {
            logger.warn("[provisioning-poll] Timed out waiting for workflow", { name: bot.name });
            await ctx.runMutation(internal.provisioning.db.updateBot, {
              id: bot._id,
              patches: {
                status: "failed",
                lastDeployStatus: "timeout",
                updatedAt: Date.now(),
              },
            });

            await ctx.runAction(internal.api.telegram.sendChatMessage, {
              chatId: bot.ownerId,
              message: `⏰ <b>Deployment timed out</b>\n\nBot "${bot.name}" deployment is taking too long. No workflow runs detected in 30 minutes.\n\nCheck your GitHub repo: https://github.com/${bot.githubRepo}/actions`,
            });
          }
          continue;
        }

        const latestRun = runs[0]!;

        await ctx.runMutation(internal.provisioning.db.updateBot, {
          id: bot._id,
          patches: {
            lastDeployStatus: latestRun.conclusion || latestRun.status,
            lastDeployCheckAt: Date.now(),
            lastDeployWorkflowRunId: latestRun.id,
          },
        });

        if (latestRun.status === "completed") {
          if (latestRun.conclusion === "success") {
            logger.info("[provisioning-poll] Deployment successful", { name: bot.name });

            await ctx.runMutation(internal.provisioning.db.updateBot, {
              id: bot._id,
              patches: {
                status: "live",
                lastDeployStatus: "success",
                updatedAt: Date.now(),
              },
            });

            await ctx.runAction(internal.api.telegram.sendChatMessage, {
              chatId: bot.ownerId,
              message: `✅ <b>${bot.name} is live!</b>\n\nDashboard: ${bot.convexSiteUrl}/settings\nRepo: https://github.com/${bot.githubRepo}\n\nYou can now message the new bot on Telegram!`,
            });
          } else {
            logger.error("[provisioning-poll] Deployment failed", undefined, {
              name: bot.name,
              conclusion: latestRun.conclusion,
            });

            await ctx.runMutation(internal.provisioning.db.updateBot, {
              id: bot._id,
              patches: {
                status: "failed",
                lastDeployStatus: latestRun.conclusion,
                updatedAt: Date.now(),
              },
            });

            await ctx.runAction(internal.api.telegram.sendChatMessage, {
              chatId: bot.ownerId,
              message: `❌ <b>Deployment failed</b> for ${bot.name}\nConclusion: ${latestRun.conclusion}\n\nCheck logs: ${latestRun.htmlUrl}`,
            });
          }
        }
      } catch (error) {
        logger.error("[provisioning-poll] Error checking bot", error, {
          botId: bot._id,
          name: bot.name,
        });
      }
    }
  },
});

"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { logger } from "../utils/logger";
import { parseDeployKey } from "./deployKeyParser";
import * as github from "./githubApi";
import { generateManagedDeployWorkflow } from "./workflowTemplate";
import { fetchUpstreamSource } from "./sourcePackager";

export const provisionNewBot = internalAction({
  args: {
    botId: v.id("provisionedBots"),
    ownerId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    telegramBotToken: v.string(),
    convexDeployKey: v.string(),
    julesApiKey: v.string(),
    githubPat: v.string(),
    llmEndpoint: v.string(),
    llmModel: v.string(),
    llmApiKey: v.string(),
    llmSdkType: v.string(),
    exaApiKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const logMeta = { data: { ownerId: args.ownerId, botName: args.name } };
    logger.info("[provision] Starting provisioning", logMeta);

    try {
      const deployInfo = parseDeployKey(args.convexDeployKey);
      if (!deployInfo) {
        throw new Error("Invalid Convex deploy key format");
      }
      logger.info("[provision] Parsed deploy key", { data: { ...logMeta.data, deploymentName: deployInfo.deploymentName } });

      logger.info("[provision] Creating GitHub repo", logMeta);
      const repo = await github.createRepo(args.name, args.description);
      logger.info("[provision] Repo created", { data: { ...logMeta.data, repo: repo.fullName } });

      logger.info("[provision] Fetching upstream source", logMeta);
      const sourceFiles = await fetchUpstreamSource();
      logger.info("[provision] Source files fetched", { data: { ...logMeta.data, fileCount: sourceFiles.length } });

      logger.info("[provision] Pushing source files to main branch", logMeta);
      const mainSHA = await github.pushInitialCommit(repo.fullName, sourceFiles);
      logger.info("[provision] Main branch created", { data: { ...logMeta.data, sha: mainSHA } });

      logger.info("[provision] Creating managed branch", logMeta);
      await github.createBranch(repo.fullName, "managed", mainSHA);
      logger.info("[provision] Managed branch created", logMeta);

      logger.info("[provision] Setting GitHub Secrets", logMeta);
      await github.setAllRepoSecrets(repo.fullName, {
        CONVEX_DEPLOY_KEY: args.convexDeployKey,
        CONVEX_SITE_URL: deployInfo.convexSiteUrl,
        TELEGRAM_BOT_TOKEN: args.telegramBotToken,
        JULES_API_KEY: args.julesApiKey,
        GITHUB_PAT: args.githubPat,
        LLM_ENDPOINT: args.llmEndpoint,
        LLM_MODEL: args.llmModel,
        LLM_API_KEY: args.llmApiKey,
        LLM_SDK_TYPE: args.llmSdkType,
        ...(args.exaApiKey ? { EXA_API_KEY: args.exaApiKey } : {}),
      });
      logger.info("[provision] GitHub Secrets set", logMeta);

      logger.info("[provision] Pushing workflow file", logMeta);
      const workflowContent = generateManagedDeployWorkflow();
      await github.pushToBranch(
        repo.fullName,
        "managed",
        [{ path: ".github/workflows/managed-deploy.yml", content: workflowContent }],
        "Add managed deployment workflow",
      );
      logger.info("[provision] Workflow pushed", logMeta);

      await ctx.runMutation(internal.provisioning.db.updateBot, {
        id: args.botId,
        patches: {
          status: "deploying",
          githubRepo: repo.fullName,
          convexSiteUrl: deployInfo.convexSiteUrl,
          updatedAt: Date.now(),
        },
      });

      logger.info("[provision] Provisioning complete, waiting for deployment", logMeta);

      return {
        success: true,
        repoUrl: repo.repoUrl,
        convexSiteUrl: deployInfo.convexSiteUrl,
      };
    } catch (error) {
      logger.error("[provision] Provisioning failed", error, logMeta);

      await ctx.runMutation(internal.provisioning.db.updateBot, {
        id: args.botId,
        patches: {
          status: "failed",
          updatedAt: Date.now(),
        },
      });

      const escapeMdv2 = (text: string) => text.replace(/([_\*\[\]\(\)~`>#+\-=|{}\.!])/g, '\\$1');
      await ctx.runAction(internal.api.telegram.sendChatMessage, {
        chatId: args.ownerId,
        message: `❌ *Provisioning failed*\n\nBot: ${args.name}\nError: ${escapeMdv2(error instanceof Error ? error.message : String(error))}\n\nYou can ask me to retry or check the details.`,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

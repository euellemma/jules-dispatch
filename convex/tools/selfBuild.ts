import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { logger } from "../utils/logger";
import { parseDeployKey } from "../provisioning/deployKeyParser";

export const provision_bot = createTool({
  description:
    "Create a new Jules Dispatch bot instance. This provisions a complete new bot: creates a GitHub repo, pushes source code, sets up CI/CD deployment pipeline, and monitors until the bot is live. " +
    "You need from the user: a name, description, Telegram bot token, and Convex deploy key. All other keys are copied from your own configuration. " +
    "The new bot will be deployed via GitHub Actions and will be live in a few minutes.",
  inputSchema: z.object({
    name: z.string().describe("A short name for the new bot (used as the GitHub repo name). Must be a valid GitHub repo name: lowercase, hyphens, no spaces."),
    description: z.string().optional().describe("A brief description of what this bot is for."),
    telegramBotToken: z.string().describe("The Telegram bot token for the new bot (from @BotFather)."),
    convexDeployKey: z.string().describe("The Convex deploy key for the new bot's deployment. Format: 'prod:name|base64data'. The user creates a Convex project and copies the deploy key."),
  }),
  execute: async (ctx, args): Promise<string> => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread.");

    logger.info("[provision_bot] Starting", { data: { name: args.name }, threadId: ctx.threadId });

    await ctx.runAction(internal.api.telegram.sendChatMessage, {
      chatId: ctx.threadId,
      message: `🚀 <b>Provisioning ${args.name}...</b>\n\nCreating GitHub repo, pushing source code, and setting up deployment. This takes 2-5 minutes. I'll let you know when it's live.`,
    });

    const userId = ctx.userId || ctx.threadId;
    const user = await ctx.runQuery(internal.users.db.getProviderConfig, {
      telegramChatId: userId,
    });

    if (!user) {
      return "Error: Could not find your user configuration. Make sure you've set up your account first.";
    }

    if (!user.providerConfig) {
      return "Error: Your LLM provider is not configured. Set it up first in settings.";
    }

    const githubPat = process.env.GITHUB_PAT;
    if (!githubPat) {
      return "Error: GITHUB_PAT is not set in this instance's environment. The administrator needs to configure it.";
    }

    const deployInfo = parseDeployKey(args.convexDeployKey);
    if (!deployInfo) {
      return "Error: Invalid Convex deploy key format. It should look like: 'prod:name|base64data'";
    }

    const botId = await ctx.runMutation(internal.provisioning.db.createBot, {
      ownerId: userId,
      name: args.name,
      description: args.description,
      githubRepo: "",
      convexSiteUrl: deployInfo.convexSiteUrl,
      status: "provisioning",
      sourceType: "upstream",
    });

    const result = await ctx.runAction(internal.provisioning.provision.provisionNewBot, {
      botId,
      ownerId: userId,
      name: args.name,
      description: args.description,
      telegramBotToken: args.telegramBotToken,
      convexDeployKey: args.convexDeployKey,
      julesApiKey: user.julesApiKey || "",
      githubPat,
      llmEndpoint: user.providerConfig.endpoint,
      llmModel: user.providerConfig.model,
      llmApiKey: user.providerConfig.apiKey,
      llmSdkType: user.providerConfig.sdkType,
      exaApiKey: user.exaApiKey || undefined,
    });

    if (result.success) {
      return `Provisioning started for "${args.name}"!\n\nRepo: ${result.repoUrl}\nDashboard: ${result.convexSiteUrl}/settings\n\nI'll notify you when the deployment is complete.`;
    } else {
      return `Provisioning failed for "${args.name}": ${result.error}\n\nYou can ask me to investigate the issue or try again.`;
    }
  },
});

#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import type { JulesDispatchConfig } from "./config.js";
import {
  readHomeConfig,
  writeHomeConfig,
  writeEnvLocal,
} from "./config.js";
import { printBanner, printOutro, c as colors, info } from "./ui.js";
import { handleError, WizardError, type WizardStep } from "./errors.js";
import {
  runStepLocation,
  runStepTelegram,
  runStepJules,
  runStepAIProvider,
  runStepExa,
  runStepConvex,
} from "./steps/index.js";
import { parseDeployKey, runConvexDeploy, buildAndUploadWeb, setupTelegramWebhook } from "./utils/deploy.js";
import { runUpdateCommand } from "./commands/update.js";
import { runDeployCommand } from "./commands/deploy.js";
import { runSyncCommand } from "./commands/sync.js";
import { cliLogger } from "./utils/logger.js";

const program = new Command();

// ─── Context Types ───────────────────────────────────────────────────────────

interface StepContext {
  installPath: string;
  telegramToken: string;
  julesApiKey: string;
  aiProvider: {
    endpoint: string;
    model: string;
    sdkType: string;
  };
  customApiKey: string;
  exaApiKey?: string;
  useExa: boolean;
  deployKey?: string;
}

// ─── Utility Functions ───────────────────────────────────────────────────────

async function installDependencies(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const install = spawn("npm", ["install"], {
      cwd: installPath,
      stdio: "ignore",
      shell: true,
    });

    install.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new WizardError(
            `npm install failed with code ${code}`,
            "location",
            true,
            "Try running 'npm install' manually in the project directory",
          ),
        );
      }
    });
  });
}

async function installWebDependencies(installPath: string): Promise<void> {
  const webPath = path.join(installPath, "web");
  if (!fs.existsSync(path.join(webPath, "package.json"))) {
    return;
  }

  return new Promise((resolve, reject) => {
    const install = spawn("npm", ["install"], {
      cwd: webPath,
      stdio: "ignore",
      shell: true,
    });

    install.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new WizardError(
            `npm install in web/ failed with code ${code}`,
            "location",
            true,
            "Try running 'npm install' manually in the web/ directory",
          ),
        );
      }
    });
  });
}

async function runDevMode(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log();
    p.log.success(colors.green("🚀 Starting development server..."));
    info("Press Ctrl+C to stop\n");

    // Run npm run dev which starts both convex dev and bot
    const dev = spawn("npm", ["run", "dev"], {
      cwd: installPath,
      stdio: "inherit",
      shell: true,
      env: { ...process.env },
    });

    dev.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Development server exited with code ${code}`));
      }
    });
  });
}

// ─── Step Execution ──────────────────────────────────────────────────────────

interface Step {
  id: WizardStep;
  label: string;
  run: (ctx: Partial<StepContext>) => Promise<void>;
}

const steps: Step[] = [
  {
    id: "telegram",
    label: "Telegram Bot",
    run: async (ctx) => {
      ctx.telegramToken = await runStepTelegram();
    },
  },
  {
    id: "jules",
    label: "Jules API",
    run: async (ctx) => {
      ctx.julesApiKey = await runStepJules();
    },
  },
  {
    id: "ai-provider",
    label: "AI Provider",
    run: async (ctx) => {
      const result = await runStepAIProvider();
      ctx.aiProvider = result.preset;
      ctx.customApiKey = result.apiKey;
    },
  },
  {
    id: "exa",
    label: "Exa Search",
    run: async (ctx) => {
      const result = await runStepExa();
      ctx.useExa = result.useExa;
      ctx.exaApiKey = result.apiKey;
    },
  },
  {
    id: "convex",
    label: "Convex Setup",
    run: async (ctx) => {
      ctx.deployKey = await runStepConvex();
    },
  },
];

async function runSteps(
  steps: Step[],
  context: Partial<StepContext>,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    p.log.step(step.label);

    try {
      await step.run(context);
    } catch (error) {
      handleError(error, step.id);

      const retry = await p.confirm({
        message: "Try again?",
        initialValue: true,
      });

      if (p.isCancel(retry) || !retry) {
        process.exit(1);
      } else {
        i--; // Retry current step
        continue;
      }
    }
  }
}

// ─── Main Wizard ─────────────────────────────────────────────────────────────

async function runFreshWizard(existingPath?: string): Promise<void> {
  const context: Partial<StepContext> = {};

  // Location step with optional pre-filled path
  context.installPath = await runStepLocation(existingPath);

  // Run remaining steps
  await runSteps(steps, context);

  // ── Finalize ──
  p.log.step("Installing dependencies...");

  const s = p.spinner();
  s.start("Installing npm packages...");

  try {
    await installDependencies(context.installPath!);
    s.stop("Dependencies installed!");

    // Install web dependencies separately
    s.start("Installing web UI dependencies...");
    await installWebDependencies(context.installPath!);
    s.stop("Web UI dependencies installed!");
  } catch (error) {
    s.stop("Installation failed");
    handleError(error, "location");

    // Offer to clean retry
    const retry = await p.confirm({
      message: "Clean node_modules and retry?",
      initialValue: true,
    });

    if (!p.isCancel(retry) && retry) {
      s.start("Cleaning and retrying...");

      try {
        const nodeModulesPath = path.join(context.installPath!, "node_modules");
        if (fs.existsSync(nodeModulesPath)) {
          fs.rmSync(nodeModulesPath, { recursive: true, force: true });
        }

        await installDependencies(context.installPath!);
        await installWebDependencies(context.installPath!);
        s.stop("Dependencies installed!");
      } catch (_retryError) {
        s.stop("Installation failed again");
        p.log.warn(
          colors.yellow("\n⚠️  npm install failed twice. Continuing setup..."),
        );
        info("You can fix this later by running:");
        info(`  cd ${context.installPath}`);
        info("  npm install");
        info("\nOther setup steps will continue.");
      }
    } else {
      info("\nSkipping npm install. You can run it manually later:");
      info(`  cd ${context.installPath}`);
      info("  npm install");
      info("\nOther setup steps will continue.");
    }
  }

  // Save config
  const config: JulesDispatchConfig = {
    installPath: context.installPath!,
    projectSlug: "jules-dispatch",
    telegramBotToken: context.telegramToken!,
    julesApiKey: context.julesApiKey!,
    exaApiKey: context.exaApiKey,
    deployKey: context.deployKey,
    customConfig: {
      endpoint: context.aiProvider!.endpoint,
      model: context.aiProvider!.model,
      apiKey: context.customApiKey!,
      sdkType: context.aiProvider!.sdkType as
        | "openai"
        | "anthropic"
        | "google"
        | "auto",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Write configuration files
  try {
    writeHomeConfig(config);

    // Write .env.local with all gathered API keys for local dev
    const envUpdates: Record<string, string> = {
      TELEGRAM_BOT_TOKEN: context.telegramToken!,
      JULES_API_KEY: context.julesApiKey!,
    };
    
    if (context.exaApiKey) {
      envUpdates.EXA_API_KEY = context.exaApiKey;
    }
    
    if (context.aiProvider && context.customApiKey) {
      envUpdates.LLM_ENDPOINT = context.aiProvider.endpoint;
      envUpdates.LLM_MODEL = context.aiProvider.model;
      envUpdates.LLM_API_KEY = context.customApiKey;
      envUpdates.LLM_SDK_TYPE = context.aiProvider.sdkType;
    }

    writeEnvLocal(context.installPath!, envUpdates);
  } catch (error) {
    p.log.error(colors.red("Failed to save configuration:"));
    if (error instanceof Error) {
      p.log.error(colors.red(error.message));
    }
    process.exit(1);
  }

  // ── Deploy if deploy key was provided ──
  if (config.deployKey) {
    console.log();
    s.start("Deploying to Convex...");

    const deploySuccess = await runConvexDeploy(
      config.deployKey,
      context.installPath!,
    );

    if (deploySuccess) {
      s.stop(colors.green("Backend deployed successfully!"));

      // Build and upload web UI
      console.log();
      s.start("Building and uploading web UI...");
      const webUploadSuccess = await buildAndUploadWeb(context.installPath!);

      if (webUploadSuccess) {
        s.stop(colors.green("Web UI deployed!"));
      } else {
        s.stop(colors.yellow("Web UI upload failed"));
        p.log.warn(
          colors.yellow("\n⚠️  Settings page may not work. You can retry with:"),
        );
        info(`  cd ${context.installPath}`);
        info("  npm run deploy:web");
      }

      const info2 = parseDeployKey(config.deployKey);
      if (info2) {
        writeEnvLocal(context.installPath!, {
          CONVEX_URL: info2.convexUrl,
          CONVEX_SITE_URL: info2.convexSiteUrl,
        });

        // Set up Telegram webhook if token exists
        if (config.telegramBotToken) {
          try {
            await setupTelegramWebhook(
              config.telegramBotToken,
              info2.convexSiteUrl,
            );
          } catch (_webhookError) {
            p.log.warn(
              colors.yellow("\n⚠️  Could not set up Telegram webhook automatically"),
            );
            info("You can set it manually later in your Telegram bot settings");
            info("Or it will be set up automatically when you start the bot");
          }
        }

        console.log();
        p.log.success(`Connected to: ${colors.cyan(info2.convexUrl)}`);
        console.log();
        p.log.success(`${colors.bold("Your bot is live!")}`);
        console.log();
        info("Message the bot on Telegram to claim ownership.");
      }
    } else {
      s.stop(colors.red("Deployment failed"));
      console.log();
      p.log.error(colors.red("Failed to deploy to Convex."));
      info("Your code is saved locally. You can retry deployment anytime with:");
      info(`  cd ${context.installPath}`);
      info("  npx convex deploy --yes");
      info("\nOr use the CLI command:");
      info("  npx jules-dispatch deploy");
    }
  } else {
    // ── Done ──
    printOutro(colors.green("✨ Setup Complete!"));

    console.log();
    p.log.success(
      `${colors.bold("Jules Dispatch")} is installed at: ${colors.cyan(context.installPath!)}`,
    );

    // Auto-start dev mode for local development
    console.log();
    try {
      await runDevMode(context.installPath!);
    } catch {
      // Dev mode exited, show restart instructions
      console.log();
      info("To restart development server:");
      info(`  cd ${context.installPath}`);
      info("  npm run dev");
    }
  }

  console.log();
}

// ─── Wizard Detection ────────────────────────────────────────────────────────

async function detectExistingInstall(): Promise<{
  found: boolean;
  path: string | null;
  config: JulesDispatchConfig | null;
}> {
  const config = readHomeConfig();
  if (config && config.installPath) {
    return { found: true, path: config.installPath, config };
  }

  return { found: false, path: null, config: null };
}

async function runWizard(): Promise<void> {
  printBanner();

  const existing = await detectExistingInstall();

  if (existing.found && existing.path) {
    info(`Found existing installation at: ${existing.path}`);

    // Check if this is a deployed installation
    if (existing.config?.deployKey) {
      // Deployed installation - recommend commands instead of fresh install
      p.log.info(colors.dim("\nThis installation is already deployed to production."));
      p.log.info(colors.dim("Use these commands to manage it:\n"));

      info(colors.cyan("  npx jules-dispatch update"));
      info(colors.dim("    Pull latest code and optionally redeploy\n"));

      info(colors.cyan("  npx jules-dispatch deploy"));
      info(colors.dim("    Deploy current code to production\n"));

      // Only allow fresh install if user explicitly wants a new instance
      const action = await p.select({
        message: "What would you like to do?",
        options: [
          {
            value: "update",
            label: "Update existing installation",
            hint: "Pull latest & optional deploy",
          },
          {
            value: "different",
            label: "Install in different location",
            hint: "Set up a new instance elsewhere",
          },
          { value: "cancel", label: "Cancel", hint: "Exit setup" },
        ],
        initialValue: "update",
      });

      if (p.isCancel(action) || action === "cancel") {
        process.exit(0);
      }

      if (action === "update") {
        await runUpdateCommand();
      } else {
        // Fresh install in different location
        await runFreshWizard();
      }
    } else {
      // Non-deployed installation - can update or do fresh install
      const action = await p.select({
        message: "What would you like to do?",
        options: [
          {
            value: "update",
            label: "Update existing",
            hint: "Pull latest & optional deploy",
          },
          {
            value: "fresh",
            label: "Fresh install",
            hint: "Wipe and start over",
          },
          {
            value: "different",
            label: "Install elsewhere",
            hint: "Keep existing, set up new instance",
          },
          { value: "cancel", label: "Cancel", hint: "Exit setup" },
        ],
        initialValue: "update",
      });

      if (p.isCancel(action) || action === "cancel") {
        process.exit(0);
      }

      if (action === "update") {
        await runUpdateCommand();
      } else if (action === "different") {
        // Fresh install in different location
        await runFreshWizard();
      } else {
        // Fresh install on existing path (will prompt to wipe)
        await runFreshWizard(existing.path);
      }
    }
  } else {
    await runFreshWizard();
  }
}

// ─── CLI Setup ───────────────────────────────────────────────────────────────

program
  .name("jules-dispatch")
  .description(
    "Jules Dispatch CLI - Setup and manage your Jules Dispatch Telegram bot",
  )
  .version("0.1.0");

program
  .command("update")
  .description("Update your Jules Dispatch installation")
  .action(async () => {
    try {
      await runUpdateCommand();
    } catch (error) {
      handleError(error, "location");
      process.exit(1);
    }
  });

program
  .command("deploy")
  .description("Deploy to Convex production")
  .action(async () => {
    try {
      await runDeployCommand();
    } catch (error) {
      handleError(error, "location");
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Sync local Executor tools and sources to Convex")
  .action(async () => {
    try {
      await runSyncCommand();
    } catch (error) {
      cliLogger.error("Sync command failed", error instanceof Error ? error : new Error(String(error)));
      process.exit(1);
    }
  });

// Parse and check if we need to run default wizard
program.parse(process.argv);

// If no command was matched, run the wizard
const options = program.opts();
if (!program.args.length && !options.update && !options.deploy) {
  (async () => {
    try {
      await runWizard();
    } catch (error) {
      handleError(error, "location");
      process.exit(1);
    }
  })();
}

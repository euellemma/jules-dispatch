#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import c from "picocolors";

const program = new Command();
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as zlib from "zlib";
import { execSync, spawn } from "child_process";
import type { JulesDispatchConfig } from "./config.js";
import {
  readHomeConfig,
  writeHomeConfig,
  findJulesDispatchProject,
  writeEnvLocal,
  createDefaultConfig,
  parseDeployKey,
  writeInitialConfig,
} from "./config.js";
import {
  getPresetById,
  getPresetChoices,
  validateUrl,
  type AIPreset,
} from "../shared/presets.js";
import { saveWizardState, clearWizardState, type WizardStep } from "./state.js";

const TEMPLATE_REPO = "https://github.com/euellemma/jules-dispatch.git";
const DEFAULT_INSTALL_PATH = path.join(os.homedir(), "jules-dispatch");

// ─── Error Handling & Recovery ──────────────────────────────────────────────

class WizardError extends Error {
  constructor(
    message: string,
    public readonly step: WizardStep,
    public readonly recoverable: boolean = true,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "WizardError";
  }
}

function handleError(error: unknown, _currentStep: WizardStep): void {
  if (error instanceof WizardError) {
    p.log.error(c.red(error.message));
    if (error.suggestion) {
      p.log.info(c.dim(`💡 ${error.suggestion}`));
    }
    if (error.recoverable) {
      p.log.info(c.dim("You can go back and try again, or cancel with Ctrl+C"));
    }
  } else if (error instanceof Error) {
    p.log.error(c.red(`Unexpected error: ${error.message}`));
    p.log.info(
      c.dim(
        "If this persists, please check your connection or try again later.",
      ),
    );
  } else {
    p.log.error(c.red("An unknown error occurred"));
  }
}

// ─── UI Components ──────────────────────────────────────────────────────────

function printBanner(): void {
  console.log();
  p.intro(`${c.bold(c.bgCyan(c.black("  Jules Dispatch Setup Wizard  ")))}`);
}

function printStep(message: string): void {
  p.log.step(message);
}

function link(url: string, text: string): string {
  // Terminal hyperlink escape sequence with URL in brackets and arrow indicator after
  return `\x1b]8;;${url}\x1b\\[${c.dim(url)}]${text}\x1b]8;;\x1b\\`;
}

// ─── Git & Archive Helpers ──────────────────────────────────────────────────

function isGitAvailable(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, ".git"));
}

// ─── Directory Validation Helper ────────────────────────────────────────────

type DirectoryState = "empty" | "partial" | "complete" | "unknown";

function getDirectoryState(installPath: string): DirectoryState {
  if (!fs.existsSync(installPath)) return "empty";

  const contents = fs.readdirSync(installPath);
  if (contents.length === 0) return "empty";

  const hasPackageJson = fs.existsSync(path.join(installPath, "package.json"));
  const hasConvexDir = fs.existsSync(path.join(installPath, "convex"));
  const hasNodeModules = fs.existsSync(path.join(installPath, "node_modules"));

  if (hasPackageJson && hasConvexDir && hasNodeModules) return "complete";
  if (hasPackageJson || hasConvexDir) return "partial";
  return "unknown";
}

function cloneWithGit(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const clone = spawn(
      "git",
      ["clone", "--progress", TEMPLATE_REPO, installPath],
      {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );

    clone.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git clone failed with code ${code}`));
      }
    });

    clone.on("error", (err) => {
      reject(err);
    });
  });
}

function extractTarGz(buf: Buffer, destDir: string): number {
  const gunzip = zlib.createGunzip();
  gunzip.write(buf);
  gunzip.end();

  const decompressed = gunzip.read() as Buffer;
  let offset = 0;
  let fileCount = 0;

  while (offset < decompressed.length) {
    if (offset + 512 > decompressed.length) break;
    const header = decompressed.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    const nameLen = header[100] === 0 ? 0 : 100;
    let name = header.subarray(0, nameLen).toString("utf-8").replace(/\0/g, "");
    if (!name) break;

    const typeChar = header[156];
    const size =
      parseInt(header.subarray(124, 136).toString("utf-8").trim(), 8) || 0;

    offset += 512;

    const slashIdx = name.indexOf("/");
    if (slashIdx >= 0) {
      name = name.substring(slashIdx + 1);
    }
    if (!name) {
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    name = name.replace(/\\/g, "/");

    if (typeChar === 53 || name.endsWith("/")) {
      const dirPath = path.join(destDir, name);
      if (!dirPath.startsWith(destDir)) {
        offset += Math.ceil(size / 512) * 512;
        continue;
      }
      fs.mkdirSync(dirPath, { recursive: true });
    } else if (typeChar === 48 || typeChar === 0) {
      const filePath = path.join(destDir, name);
      if (!filePath.startsWith(destDir)) {
        offset += Math.ceil(size / 512) * 512;
        continue;
      }
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      if (size > 0) {
        const content = decompressed.subarray(offset, offset + size);
        fs.writeFileSync(filePath, content);
      } else {
        fs.writeFileSync(filePath, "");
      }
      fileCount++;
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return fileCount;
}

async function downloadAndExtract(installPath: string): Promise<void> {
  const archiveUrl =
    "https://github.com/euellemma/jules-dispatch/archive/refs/heads/main.tar.gz";

  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new WizardError(
      `Failed to download: ${response.status} ${response.statusText}`,
      "location",
      true,
      "Check your internet connection and try again",
    );
  }

  const arrayBuf = await response.arrayBuffer();
  const buf = Buffer.from(arrayBuf);

  fs.mkdirSync(installPath, { recursive: true });
  const fileCount = extractTarGz(buf, installPath);
  console.log(c.dim(`   Extracted ${fileCount} files`));
}

async function cloneScaffold(installPath: string): Promise<void> {
  if (fs.existsSync(installPath)) {
    throw new WizardError(
      `Directory ${installPath} already exists`,
      "location",
      true,
      "Choose a different location or use the existing directory",
    );
  }

  if (isGitAvailable()) {
    try {
      await cloneWithGit(installPath);
      return;
    } catch {
      // Fall through to download
    }
  }

  await downloadAndExtract(installPath);
}

async function pullLatest(installPath: string): Promise<void> {
  if (isGitRepo(installPath) && isGitAvailable()) {
    try {
      await new Promise<void>((resolve, reject) => {
        const pull = spawn("git", ["pull"], {
          cwd: installPath,
          stdio: "ignore",
        });

        pull.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Git pull failed with code ${code}`));
          }
        });

        pull.on("error", (err) => {
          reject(err);
        });
      });
      return;
    } catch {
      // Fall through to download
    }
  }

  await downloadAndExtract(installPath);
}

// ─── Dependencies & Deploy ──────────────────────────────────────────────────

async function setConvexEnvVars(
  installPath: string,
  envVars: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["convex", "env", "set"];

    // Add each env var as key=value pairs
    for (const [key, value] of Object.entries(envVars)) {
      args.push(`${key}=${value}`);
    }

    const setEnv = spawn("npx", args, {
      cwd: installPath,
      stdio: "pipe",
      shell: true,
      env: { ...process.env },
    });

    let stderr = "";
    setEnv.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    setEnv.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Don't fail the entire setup if env set fails - .env.local might still work
        console.log(c.yellow(`⚠️  Could not set Convex env vars: ${stderr}`));
        resolve();
      }
    });
  });
}

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

async function runDevMode(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log();
    p.log.success(c.green("🚀 Starting development server..."));
    p.log.info(c.dim("Press Ctrl+C to stop\n"));

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

async function runConvexDeploy(
  deployKey: string,
  installPath: string,
): Promise<boolean> {
  process.env.CONVEX_DEPLOY_KEY = deployKey;

  return new Promise((resolve) => {
    const deploy = spawn("npx", ["convex", "deploy", "--yes"], {
      cwd: installPath,
      stdio: "inherit",
      shell: true,
      env: { ...process.env },
    });

    deploy.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function setupTelegramWebhook(
  telegramToken: string,
  siteUrl: string,
): Promise<void> {
  const webhookUrl = `${siteUrl}/telegram`;
  const apiUrl = `https://api.telegram.org/bot${telegramToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  try {
    const response = await fetch(apiUrl);
    const data = (await response.json()) as {
      ok: boolean;
      description?: string;
    };

    if (!data.ok) {
      p.log.warn(
        c.yellow(`⚠️ Webhook setup: ${data.description || "Unknown error"}`),
      );
    }
  } catch {
    p.log.warn(c.yellow("⚠️ Could not set Telegram webhook automatically"));
    p.log.info(c.dim(`Set it manually: ${apiUrl}`));
  }
}

// ─── Steps ────────────────────────────────────────────────────────────────────

interface StepContext {
  installPath: string;
  telegramToken: string;
  julesApiKey: string;
  aiProvider: AIPreset;
  customApiKey: string;
  exaApiKey?: string;
  useExa: boolean;
  deployKey?: string;
  convexMode: "local" | "deploy";
}

async function promptForDeployKey(): Promise<string | null> {
  p.log.message(c.cyan("🔗 Convex Deploy Key"));
  p.log.info(
    c.dim(
      `1. Go to ${link("https://dashboard.convex.dev", "dashboard.convex.dev")}`,
    ),
  );
  p.log.info(c.dim("2. Create a new project"));
  p.log.info(c.dim("3. Settings → Deploy Keys"));
  p.log.info(c.dim("4. Create a new key"));

  const deployKey = await p.text({
    message: "Paste your Convex deploy key",
    placeholder: "team:project|eyJ...",
    validate: (value) => {
      if (!value) return "Deploy key is required";
      const info = parseDeployKey(value);
      if (!info) return "Invalid deploy key format";
    },
  });

  if (p.isCancel(deployKey)) {
    return null;
  }

  const info = parseDeployKey(deployKey as string);
  if (info) {
    p.log.success(`Team: ${c.bold(info.team)}`);
    p.log.success(`Deployment: ${c.bold(info.deploymentName)}`);
  }

  return deployKey as string;
}

async function runStepLocation(): Promise<string> {
  const defaultPath = DEFAULT_INSTALL_PATH;

  const installPath = await p.text({
    message: "Installation path",
    placeholder: defaultPath,
    defaultValue: defaultPath,
    validate: (value) => {
      const resolved = value ? path.resolve(value) : defaultPath;
      if (fs.existsSync(resolved)) {
        const stats = fs.statSync(resolved);
        if (!stats.isDirectory()) {
          return "Path exists but is not a directory";
        }
      }
    },
  });

  if (p.isCancel(installPath)) {
    process.exit(0);
  }

  // Use default if empty string
  const finalPath = (installPath as string)?.trim() || defaultPath;
  const resolvedPath = path.resolve(finalPath);

  // Check if directory exists and handle accordingly
  const dirState = getDirectoryState(resolvedPath);

  if (dirState !== "empty") {
    const stateDescription = {
      partial: "partial installation",
      complete: "complete installation",
      unknown: "existing files",
    }[dirState];

    p.log.warn(c.yellow(`⚠️  Directory exists with ${stateDescription}`));

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        {
          value: "clear",
          label: "Clear and start fresh",
          hint: "Delete everything and start over",
        },
        {
          value: "different",
          label: "Choose different location",
          hint: "Pick another directory",
        },
        { value: "cancel", label: "Cancel", hint: "Exit setup" },
      ],
      initialValue: "clear",
    });

    if (p.isCancel(action) || action === "cancel") {
      process.exit(0);
    }

    if (action === "different") {
      // Recursively call to get a different path
      return runStepLocation();
    }

    if (action === "clear") {
      const confirmClear = await p.confirm({
        message: c.red(
          `Are you sure you want to delete everything in ${c.bold(resolvedPath)}?`,
        ),
        initialValue: false,
      });

      if (p.isCancel(confirmClear) || !confirmClear) {
        process.exit(0);
      }

      const s = p.spinner();
      s.start("Clearing directory...");

      try {
        fs.rmSync(resolvedPath, { recursive: true, force: true });
        s.stop("Directory cleared!");
      } catch (error) {
        s.stop("Failed to clear directory");
        throw new WizardError(
          `Failed to clear directory: ${error}`,
          "location",
          true,
          "Check permissions or manually delete the directory",
        );
      }
    }
  }

  return resolvedPath;
}

async function runStepTelegram(): Promise<string> {
  const token = await p.password({
    message:
      "Enter your Telegram bot token (use the mini-app and click 'Open')",
    mask: "•",
    validate: (value) => {
      if (!value) return "Telegram bot token is required";
    },
  });

  if (p.isCancel(token)) {
    process.exit(0);
  }

  return token as string;
}

async function runStepJules(): Promise<string> {
  const apiKey = await p.password({
    message: `Enter your Jules API key ${link("https://jules.google.com/settings/api", "↗")}`,
    mask: "•",
    validate: (value) => {
      if (!value) return "Jules API key is required";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return apiKey as string;
}

async function runStepAIProvider(): Promise<{
  preset: AIPreset;
  apiKey: string;
}> {
  const choices = getPresetChoices();
  const selection = await p.select({
    message: "Select your AI provider",
    options: choices,
    initialValue: "opencode",
  });

  if (p.isCancel(selection)) {
    process.exit(0);
  }

  const preset = getPresetById(selection as string);
  if (!preset) {
    throw new WizardError("Failed to get preset", "ai-provider", false);
  }

  // If custom, prompt for endpoint and model
  if (preset.id === "custom") {
    const endpoint = await p.text({
      message: "Enter API endpoint URL",
      placeholder: "https://api.example.com/v1",
      validate: (value) => {
        if (!value) return "Endpoint is required";
        if (!validateUrl(value)) return "Invalid URL format";
      },
    });

    if (p.isCancel(endpoint)) {
      process.exit(0);
    }

    const model = await p.text({
      message: "Enter model name",
      placeholder: "gpt-4-turbo",
      validate: (value) => {
        if (!value) return "Model name is required";
      },
    });

    if (p.isCancel(model)) {
      process.exit(0);
    }

    preset.endpoint = endpoint as string;
    preset.model = model as string;
  }

  // Prompt for API key
  const apiKey = await p.password({
    message: `Enter your ${preset.name} API key`,
    mask: "•",
    validate: (value) => {
      if (!value) return "API key is required";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return { preset, apiKey: apiKey as string };
}

async function runStepExa(): Promise<{ useExa: boolean; apiKey?: string }> {
  const message = `Exa gives your agent web search superpowers (1k free searches/mo)
Without it, your agent is limited to training data knowledge only.`;

  const choice = await p.confirm({
    message,
    initialValue: true,
  });

  if (p.isCancel(choice)) {
    process.exit(0);
  }

  if (!choice) {
    return { useExa: false };
  }

  const apiKey = await p.text({
    message: `Enter Exa API key ${link("https://dashboard.exa.ai/register", "(get free key ↗)")}`,
    validate: (v) => {
      if (!v || v.trim().length < 10) return "Please enter a valid API key";
    },
  });

  if (p.isCancel(apiKey)) {
    process.exit(0);
  }

  return { useExa: true, apiKey: (apiKey as string).trim() };
}

async function runStepConvex(): Promise<{
  mode: "local" | "deploy";
  deployKey?: string;
}> {
  const mode = await p.select({
    message: "How do you want to run Convex?",
    options: [
      {
        value: "local",
        label: "Test locally first",
        hint: "No account needed, runs on your machine",
      },
      {
        value: "deploy",
        label: "Deploy to Convex",
        hint: "Requires deploy key from dashboard.convex.dev (gets one free)",
      },
    ],
  });

  if (p.isCancel(mode)) {
    process.exit(0);
  }

  if (mode === "local") {
    return { mode: "local" };
  }

  const deployKey = await promptForDeployKey();
  if (!deployKey) {
    p.log.warn(c.yellow("No deploy key provided. Falling back to local mode."));
    return { mode: "local" };
  }

  return { mode: "deploy", deployKey };
}

// ─── Main Wizard ────────────────────────────────────────────────────────────

async function runFreshWizard(): Promise<void> {
  const context: Partial<StepContext> = {};

  const steps: { id: WizardStep; label: string; run: () => Promise<void> }[] = [
    {
      id: "location",
      label: "Installation Location",
      run: async () => {
        context.installPath = await runStepLocation();
        const s = p.spinner();
        s.start("Fetching code repository...");
        try {
          await cloneScaffold(context.installPath);
          s.stop("Repository downloaded!");
        } catch (error) {
          s.stop("Failed to download repository");
          throw error;
        }
      },
    },
    {
      id: "telegram",
      label: "Telegram Bot",
      run: async () => {
        context.telegramToken = await runStepTelegram();
      },
    },
    {
      id: "jules",
      label: "Jules API",
      run: async () => {
        context.julesApiKey = await runStepJules();
      },
    },
    {
      id: "ai-provider",
      label: "AI Provider",
      run: async () => {
        const result = await runStepAIProvider();
        context.aiProvider = result.preset;
        context.customApiKey = result.apiKey;
      },
    },
    {
      id: "exa",
      label: "Exa Search",
      run: async () => {
        const result = await runStepExa();
        context.useExa = result.useExa;
        context.exaApiKey = result.apiKey;
      },
    },
    {
      id: "convex",
      label: "Convex Setup",
      run: async () => {
        const result = await runStepConvex();
        context.convexMode = result.mode;
        context.deployKey = result.deployKey;
      },
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;

    printStep(step.label);

    try {
      await step.run();

      // Save state after each step
      const nextStep = steps[i + 1];
      saveWizardState({
        step: nextStep?.id ?? "complete",
        installPath: context.installPath,
        telegramBotToken: context.telegramToken,
        julesApiKey: context.julesApiKey,
        exaApiKey: context.exaApiKey,
        useExa: context.useExa,
        deployKey: context.deployKey,
        convexMode: context.convexMode,
      });
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

  // ── Finalize ──
  printStep("Installing dependencies...");

  const s = p.spinner();
  s.start("Installing npm packages...");

  try {
    await installDependencies(context.installPath!);
    s.stop("Dependencies installed!");
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
        s.stop("Dependencies installed!");
      } catch (_retryError) {
        s.stop("Installation failed again");
        p.log.warn(
          c.yellow("\n⚠️  npm install failed twice. Continuing setup..."),
        );
        p.log.info(c.dim("You can fix this later by running:"));
        p.log.info(c.dim(`  cd ${context.installPath}`));
        p.log.info(c.dim("  npm install"));
        p.log.info(c.dim("\nOther setup steps will continue."));
      }
    } else {
      p.log.info(
        c.dim("\nSkipping npm install. You can run it manually later:"),
      );
      p.log.info(c.dim(`  cd ${context.installPath}`));
      p.log.info(c.dim("  npm install"));
      p.log.info(c.dim("\nOther setup steps will continue."));
    }
  }

  // Save config
  const config: JulesDispatchConfig = {
    installPath: context.installPath!,
    projectSlug: "jules-dispatch",
    telegramBotToken: context.telegramToken,
    julesApiKey: context.julesApiKey,
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

  // Write configuration files - only clear state after all writes succeed
  try {
    writeHomeConfig(config);

    // Write .env.local with Telegram bot token
    // LLM and Jules config is written to convex/config/initial.ts for user seeding
    writeEnvLocal(context.installPath!, {
      TELEGRAM_BOT_TOKEN: context.telegramToken!,
    });

    // Clear state on success - only after all writes completed
    clearWizardState();
  } catch (error) {
    p.log.error(c.red("Failed to save configuration:"));
    if (error instanceof Error) {
      p.log.error(c.red(error.message));
    }
    p.log.info(
      c.dim(
        "Your setup progress is preserved. You can retry by running the wizard again.",
      ),
    );
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
      s.stop(c.green("Deployed successfully!"));

      const info = parseDeployKey(config.deployKey);
      if (info) {
        writeEnvLocal(context.installPath!, {
          CONVEX_URL: info.convexUrl,
          CONVEX_SITE_URL: info.convexSiteUrl,
        });

        // Set up Telegram webhook if token exists
        if (config.telegramBotToken) {
          try {
            await setupTelegramWebhook(
              config.telegramBotToken,
              info.convexSiteUrl,
            );
          } catch (_webhookError) {
            p.log.warn(
              c.yellow("\n⚠️  Could not set up Telegram webhook automatically"),
            );
            p.log.info(
              c.dim(
                "You can set it manually later in your Telegram bot settings",
              ),
            );
            p.log.info(
              c.dim(
                "Or it will be set up automatically when you start the bot",
              ),
            );
          }
        }

        console.log();
        p.log.success(`Connected to: ${c.cyan(info.convexUrl)}`);
        console.log();
        p.log.success(`${c.bold("Your bot is live! 🚀")}`);
        console.log();
        p.log.info(c.dim("To start the bot locally (pointing at production):"));
        p.log.info(c.dim(`  cd ${context.installPath}`));
        p.log.info(c.dim("  npm run dev:bot"));
      }
    } else {
      s.stop(c.red("Deployment failed"));
      console.log();
      p.log.error(c.red("Failed to deploy to Convex."));
      p.log.info(
        c.dim(
          "Your code is saved locally. You can retry deployment anytime with:",
        ),
      );
      p.log.info(c.dim(`  cd ${context.installPath}`));
      p.log.info(c.dim("  npx convex deploy --yes"));
      p.log.info(c.dim("\nOr use the CLI command:"));
      p.log.info(c.dim("  npx jules-dispatch deploy"));
    }
  } else {
    // ── Done ──
    p.outro(c.green("✨ Setup Complete!"));

    console.log();
    p.log.success(
      `${c.bold("Jules Dispatch")} is installed at: ${c.cyan(context.installPath!)}`,
    );

    // Write initial config to convex/config/initial.ts for seeding new users
    if (context.aiProvider && context.customApiKey) {
      writeInitialConfig(context.installPath!, {
        telegramBotToken: context.telegramToken!,
        julesApiKey: context.julesApiKey!,
        exaApiKey: context.exaApiKey,
        llmEndpoint: context.aiProvider.endpoint,
        llmModel: context.aiProvider.model,
        llmApiKey: context.customApiKey,
        llmSdkType: context.aiProvider.sdkType,
      });
    }

    // Auto-start dev mode for local development
    console.log();
    try {
      await runDevMode(context.installPath!);
    } catch {
      // Dev mode exited, show restart instructions
      console.log();
      p.log.info(c.dim("To restart development server:"));
      p.log.info(c.dim(`  cd ${context.installPath}`));
      p.log.info(c.dim("  npm run dev"));
    }
  }

  console.log();
}

// ─── Update Command ─────────────────────────────────────────────────────────

async function runUpdateCommand(): Promise<void> {
  const config = readHomeConfig();
  if (!config) {
    p.log.error(c.red("No existing Jules Dispatch installation found."));
    p.log.info(c.dim("Run 'npx jules-dispatch' to set up a new installation."));
    process.exit(1);
  }

  const installPath = config.installPath;
  if (!fs.existsSync(installPath)) {
    p.log.error(c.red(`Installation directory not found: ${installPath}`));
    process.exit(1);
  }

  p.intro(`${c.bold(c.bgBlue(c.black("  Jules Dispatch Update  ")))}`);

  const s = p.spinner();
  s.start("Pulling latest changes...");

  try {
    await pullLatest(installPath);
    s.stop("Code updated!");
  } catch (error) {
    s.stop("Update failed");
    handleError(error, "location");
    process.exit(1);
  }

  s.start("Installing dependencies...");
  try {
    await installDependencies(installPath);
    s.stop("Dependencies updated!");
  } catch (error) {
    s.stop("Installation failed");
    handleError(error, "location");
    p.log.warn(c.yellow("\nRun 'npm install' manually to complete."));
  }

  // Deploy if key exists
  if (config.deployKey) {
    const deploy = await p.confirm({
      message: "Deploy to production?",
      initialValue: true,
    });

    if (!p.isCancel(deploy) && deploy) {
      s.start("Deploying to Convex...");
      const success = await runConvexDeploy(config.deployKey, installPath);

      if (success) {
        s.stop(c.green("Deployed successfully!"));

        const keyInfo = parseDeployKey(config.deployKey);
        if (keyInfo) {
          writeEnvLocal(installPath, {
            CONVEX_URL: keyInfo.convexUrl,
            CONVEX_SITE_URL: keyInfo.convexSiteUrl,
          });

          if (config.telegramBotToken) {
            await setupTelegramWebhook(
              config.telegramBotToken,
              keyInfo.convexSiteUrl,
            );
          }

          p.log.success(`Dashboard: ${c.cyan(keyInfo.convexSiteUrl)}/settings`);
        }
      } else {
        s.stop(c.red("Deployment failed"));
        p.log.error(
          c.red("\nDeployment failed. Check the output above for details."),
        );
        process.exit(1);
      }
    }
  } else {
    p.log.info(c.dim("\nNo deploy key configured."));
    const addKey = await p.confirm({
      message: "Add a deploy key now?",
      initialValue: false,
    });

    if (!p.isCancel(addKey) && addKey) {
      const deployKey = await promptForDeployKey();
      if (deployKey) {
        config.deployKey = deployKey;
        config.updatedAt = new Date().toISOString();
        writeHomeConfig(config);

        s.start("Deploying to Convex...");
        const success = await runConvexDeploy(deployKey, installPath);

        if (success) {
          s.stop(c.green("Deployed successfully!"));
        } else {
          s.stop(c.red("Deployment failed"));
        }
      }
    }
  }

  p.outro(c.green("✨ Update Complete!"));
}

// ─── Deploy Command ───────────────────────────────────────────────────────────

async function runDeployCommand(): Promise<void> {
  const config = readHomeConfig();
  if (!config) {
    p.log.error(c.red("No Jules Dispatch installation found."));
    p.log.info(c.dim("Run 'npx jules-dispatch' to set up first."));
    process.exit(1);
  }

  const installPath = config.installPath;
  if (!fs.existsSync(installPath)) {
    p.log.error(c.red(`Installation not found: ${installPath}`));
    process.exit(1);
  }

  p.intro(`${c.bold(c.bgGreen(c.black("  Jules Dispatch Deploy  ")))}`);

  let deployKey = config.deployKey;

  if (!deployKey) {
    p.log.info(c.dim("No deploy key saved yet.\n"));
    const newDeployKey = await promptForDeployKey();

    if (!newDeployKey) {
      p.log.error(c.red("Deploy key required for production deployment."));
      process.exit(1);
    }

    deployKey = newDeployKey ?? undefined;
    config.deployKey = newDeployKey ?? undefined;
    config.updatedAt = new Date().toISOString();
    writeHomeConfig(config);
  }

  const keyInfo = parseDeployKey(deployKey);
  p.log.info(c.dim(`Deploying to: ${keyInfo?.deploymentName || "unknown"}\n`));

  const s = p.spinner();
  s.start("Deploying to Convex...");

  const success = await runConvexDeploy(deployKey, installPath);

  if (success) {
    s.stop(c.green("Deployed successfully!"));

    if (keyInfo) {
      writeEnvLocal(installPath, {
        CONVEX_URL: keyInfo.convexUrl,
        CONVEX_SITE_URL: keyInfo.convexSiteUrl,
      });

      if (config.telegramBotToken) {
        await setupTelegramWebhook(
          config.telegramBotToken,
          keyInfo.convexSiteUrl,
        );
      }

      console.log();
      p.log.success(`${c.bold("Your bot is live!")}`);
      p.log.info(`Dashboard: ${c.cyan(keyInfo.convexSiteUrl)}/settings`);
      console.log();
      p.log.message(c.bold("Next:"));
      p.log.info(`${c.dim("1.")} cd ${installPath}`);
      p.log.info(`${c.dim("2.")} npm run dev`);
    }
  } else {
    s.stop(c.red("Deployment failed"));
    p.log.error(
      c.red("\nDeployment failed. Check the output above for details."),
    );
    p.log.info(c.dim("Common fixes:"));
    p.log.info(c.dim("  • Check your deploy key is valid"));
    p.log.info(c.dim("  • Ensure you have internet connectivity"));
    p.log.info(c.dim("  • Try running: npx convex deploy --yes"));
    process.exit(1);
  }

  p.outro(c.green("✨ Deployment Complete!"));
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

async function detectExistingInstall(): Promise<{
  found: boolean;
  path: string | null;
  config: JulesDispatchConfig | null;
}> {
  const existingPath = findJulesDispatchProject();

  if (existingPath) {
    const config = readHomeConfig();
    if (config && config.installPath === existingPath) {
      return { found: true, path: existingPath, config };
    }
  }

  const homeConfig = readHomeConfig();
  if (homeConfig) {
    return { found: true, path: homeConfig.installPath, config: homeConfig };
  }

  if (fs.existsSync(DEFAULT_INSTALL_PATH)) {
    const config = createDefaultConfig(DEFAULT_INSTALL_PATH);
    return { found: true, path: DEFAULT_INSTALL_PATH, config };
  }

  return { found: false, path: null, config: null };
}

async function runWizard(): Promise<void> {
  printBanner();

  const existing = await detectExistingInstall();

  if (existing.found && existing.path && existing.config) {
    p.log.info(c.dim(`Found existing installation at: ${existing.path}`));

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
          hint: "Set up a new instance",
        },
      ],
    });

    if (p.isCancel(action)) {
      process.exit(0);
    }

    if (action === "update") {
      await runUpdateCommand();
    } else {
      await runFreshWizard();
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

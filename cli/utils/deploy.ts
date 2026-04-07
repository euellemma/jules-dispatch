import { spawn, spawnSync } from "child_process";
import * as p from "@clack/prompts";
import c from "picocolors";
import { parseDeployKey } from "../config.js";
import { withRetry } from "./retry.js";

export async function runConvexDeploy(
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

export async function buildAndUploadWeb(installPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const upload = spawn(
      "npx",
      ["@convex-dev/static-hosting", "upload", "--dist", "./web/dist", "--prod", "--component", "staticHosting"],
      {
        cwd: installPath,
        stdio: "inherit",
        shell: true,
        env: { ...process.env },
      },
    );

    upload.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

export function setConvexEnvVars(
  installPath: string,
  envVars: Record<string, string>,
): boolean {
  let allSucceeded = true;
  for (const [key, value] of Object.entries(envVars)) {
    try {
      spawnSync("npx", ["convex", "env", "set", `${key}=${value}`, "--prod"], {
        cwd: installPath,
        stdio: "pipe",
        shell: true,
      });
    } catch {
      allSucceeded = false;
    }
  }
  return allSucceeded;
}

export async function setupTelegramWebhook(
  telegramToken: string,
  siteUrl: string,
): Promise<void> {
  const webhookUrl = `${siteUrl}/telegram`;
  const apiUrl = `https://api.telegram.org/bot${telegramToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  try {
    const data = await withRetry(
      async () => {
        const response = await fetch(apiUrl);
        const result = (await response.json()) as {
          ok: boolean;
          description?: string;
        };

        if (!result.ok) {
          // Telegram returns 200 OK even for errors, so check the result
          throw new Error(result.description || "Webhook setup failed");
        }

        return result;
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (attempt, error) => {
          p.log.warn(
            c.yellow(`⚠️  Webhook attempt ${attempt} failed: ${error.message}`),
          );
        },
      },
    );

    // Success - webhook was set up
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    p.log.warn(c.yellow("⚠️ Could not set Telegram webhook automatically"));
    p.log.info(c.dim(`Error: ${errorMsg}`));
    p.log.info(c.dim(`Set it manually: ${apiUrl}`));
  }
}

export { parseDeployKey };

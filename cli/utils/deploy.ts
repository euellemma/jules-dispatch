import { spawn } from "child_process";
import * as p from "@clack/prompts";
import c from "picocolors";
import { parseDeployKey } from "../config.js";

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
      ["@convex-dev/static-hosting", "upload", "--build", "--prod"],
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

export async function setupTelegramWebhook(
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    p.log.warn(c.yellow("⚠️ Could not set Telegram webhook automatically"));
    p.log.info(c.dim(`Error: ${errorMsg}`));
    p.log.info(c.dim(`Set it manually: ${apiUrl}`));
  }
}

export { parseDeployKey };

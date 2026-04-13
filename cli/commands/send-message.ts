import * as fs from "fs";
import * as path from "path";
import { readHomeConfig, parseDeployKey } from "../config.js";
import { cliLogger } from "../utils/logger.js";
import { info, success, error, jsonOut } from "../utils/output.js";

const WAIT_POLL_INTERVAL_MS = 2000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function getConvexSiteUrl(config: ReturnType<typeof readHomeConfig>): string {
  const envUrl = process.env.JULES_DISPATCH_SITE_URL;
  if (envUrl) return envUrl;

  if (!config?.installPath) return "";
  const envLocalPath = path.join(config.installPath, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const env = fs.readFileSync(envLocalPath, "utf-8");
    const urlMatch = env.match(/CONVEX_SITE_URL=(.+)/);
    if (urlMatch) return urlMatch[1]!.trim();
  }
  if (config.deployKey) {
    const keyInfo = parseDeployKey(config.deployKey);
    if (keyInfo) return keyInfo.convexSiteUrl;
  }
  return "";
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8").trim());
    });
    process.stdin.on("error", () => resolve(""));
  });
}

async function waitForResponse(
  convexSiteUrl: string,
  deployKey: string,
  threadId: string,
): Promise<string> {
  const startTime = Date.now();

  while (Date.now() - startTime < WAIT_TIMEOUT_MS) {
    try {
      const response = await fetch(`${convexSiteUrl}/api/get-response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deployKey}`,
        },
        body: JSON.stringify({ threadId }),
      });

      if (response.ok) {
        const result = await response.json() as { response: string | null };
        if (result.response) {
          return result.response;
        }
      }
    } catch {
      // Network hiccup — retry
    }

    await new Promise((r) => setTimeout(r, WAIT_POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for agent response");
}

export async function runSendMessageCommand(
  message?: string,
  options?: { json?: boolean; wait?: boolean },
) {
  cliLogger.info("Send message command started");

  let finalMessage: string | undefined = message;

  if (!finalMessage) {
    if (!process.stdin.isTTY) {
      finalMessage = await readStdin();
    }
  }

  if (!finalMessage) {
    error("No input given. Provide a message as an argument or via stdin.");
    process.exit(1);
  }

  const deployKey = process.env.JULES_DISPATCH_DEPLOY_KEY;
  let config: ReturnType<typeof readHomeConfig> = null;

  if (!deployKey) {
    config = readHomeConfig();
    if (!config?.deployKey) {
      error("No deploy key found. Set JULES_DISPATCH_DEPLOY_KEY or run setup first.");
      process.exit(1);
    }
  }

  const convexSiteUrl = getConvexSiteUrl(config);
  if (!convexSiteUrl) {
    error("Could not determine Convex site URL. Set JULES_DISPATCH_SITE_URL or run deploy first.");
    process.exit(1);
  }

  const keyToUse = deployKey || config?.deployKey;

  if (!options?.json) {
    info(`Sending message: "${finalMessage.slice(0, 50)}${finalMessage.length > 50 ? "..." : ""}"`);
  }

  try {
    const response = await fetch(`${convexSiteUrl}/api/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${keyToUse}`,
      },
      body: JSON.stringify({ message: finalMessage }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) {
        error("Authentication failed. Check your deploy key.");
      } else if (response.status === 400) {
        error(`Bad request: ${errorBody}`);
      } else {
        error(`Server error (${response.status}): ${errorBody}`);
      }
      process.exit(1);
    }

    const result = await response.json() as { success: boolean; threadId: string; agentTriggered: boolean };

    if (!result.success) {
      error("Failed to send message.");
      process.exit(1);
    }

    // --wait: poll for agent response
    if (options?.wait) {
      if (!options.json) {
        info("Generating...");
      }

      try {
        const agentResponse = await waitForResponse(convexSiteUrl, keyToUse!, result.threadId);
        if (options.json) {
          jsonOut({ success: true, threadId: result.threadId, response: agentResponse });
        } else {
          info(`Jules Dispatch: ${agentResponse}`);
        }
      } catch (waitErr: any) {
        if (options.json) {
          jsonOut({ success: true, threadId: result.threadId, response: null, error: waitErr.message });
        } else {
          error(waitErr.message);
        }
        process.exit(1);
      }
    } else if (options?.json) {
      jsonOut({ success: true, threadId: result.threadId, agentTriggered: result.agentTriggered });
    } else {
      success("Message sent successfully.");
      info(`Thread: ${result.threadId}`);
      if (result.agentTriggered) {
        info("Bot is processing your message...");
      } else {
        info("Message queued (bot is busy).");
      }
    }
  } catch (err: any) {
    cliLogger.error("Send message failed", err);
    error(`Network error: ${err.message}`);
    process.exit(2);
  }
}

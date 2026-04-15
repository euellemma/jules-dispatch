import * as fs from "fs";
import * as path from "path";

import { readHomeConfig } from "../config.js";
import { getConvexSiteUrl } from "../utils.js";
import { cliLogger } from "../utils/logger.js";
import { info, success, error, jsonOut } from "../utils/output.js";

const POLL_INTERVAL_MS = 3000;
const MAX_CONTEXT_SIZE = 100_000;

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (chunk) => chunks.push(chunk));
      process.stdin.on("end", () => {
        resolve(Buffer.concat(chunks).toString("utf-8").trim());
      });
      process.stdin.on("error", () => resolve(""));
    } else {
      resolve("");
    }
  });
}

async function pollForInstruction(
  convexSiteUrl: string,
  deployKey: string,
  interactionId: string,
): Promise<string> {
  while (true) {
    try {
      const response = await fetch(`${convexSiteUrl}/api/get-instruction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deployKey}`,
        },
        body: JSON.stringify({ interactionId }),
      });

      if (response.ok) {
        const result = await response.json() as { status: string; response: string | null; interactionId?: string };
        if (result.status === "responded" && result.response) {
          return result.response;
        }
        if (result.status === "consumed") {
          throw new Error("Interaction was consumed by another process. Use a unique session label and try again.");
        }
      }
    } catch (err: any) {
      if (err.message && err.message.includes("consumed")) throw err;
      // Network hiccup — retry
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export async function runPauseAndWaitCommand(
  sessionLabel: string,
  file: string | undefined,
  options?: { json?: boolean; context?: string },
) {
  cliLogger.info("Pause-and-wait command started");

  if (!sessionLabel || !sessionLabel.trim()) {
    error("session-label is required and must be a non-empty kebab identifier.");
    process.exit(1);
  }

  // Kebab validation
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(sessionLabel)) {
    error("session-label must be a simple kebab-case identifier (lowercase letters, numbers, hyphens).");
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

  let filePath = "";
  let fileContent = "";

  if (file) {
    const resolvedPath = path.resolve(file);
    if (!fs.existsSync(resolvedPath)) {
      error(`File not found: ${resolvedPath}`);
      process.exit(1);
    }
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      error(`Not a file: ${resolvedPath}`);
      process.exit(1);
    }
    filePath = path.basename(resolvedPath);
    fileContent = fs.readFileSync(resolvedPath, "utf-8");
  } else {
    // Try reading from stdin if available
    if (!process.stdin.isTTY) {
      const stdinContent = await readStdin();
      if (stdinContent) {
        fileContent = stdinContent;
        filePath = "stdin";
      }
    }
  }

  // Read additional context from --context flag or stdin
  let context = options?.context;
  if (!context && !process.stdin.isTTY && !file) {
    const stdinContent = await readStdin();
    if (stdinContent) {
      context = stdinContent;
    }
  }

  const totalSize = fileContent.length + (context?.length ?? 0);
  if (totalSize > MAX_CONTEXT_SIZE) {
    error(`Context too large (${totalSize} bytes). Maximum is ${MAX_CONTEXT_SIZE} bytes.`);
    process.exit(1);
  }

  if (!options?.json) {
    info(`Pausing session: ${sessionLabel}`);
    if (filePath) {
      info(`Context file: ${filePath}`);
    }
    info("Waiting for instruction from Jules Dispatch...");
  }

  try {
    const response = await fetch(`${convexSiteUrl}/api/pause-and-wait`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${keyToUse}`,
      },
      body: JSON.stringify({
        sessionLabel,
        filePath,
        fileContent,
        context,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) {
        error("Authentication failed. Check your deploy key.");
      } else if (response.status === 409) {
        const conflict = JSON.parse(errorBody);
        if (options?.json) {
          jsonOut({ success: false, error: conflict.error, existingInteractionId: conflict.existingInteractionId });
        } else {
          error(conflict.error);
          info("Use a unique session label for each interaction, then retry.");
        }
        process.exit(1);
      } else if (response.status === 400) {
        error(`Bad request: ${errorBody}`);
      } else {
        error(`Server error (${response.status}): ${errorBody}`);
      }
      process.exit(1);
    }

    const result = await response.json() as { success: boolean; interactionId: string; sessionLabel: string };

    if (!result.success) {
      error("Failed to create interaction.");
      process.exit(1);
    }

    // Now poll for the response
    const instruction = await pollForInstruction(convexSiteUrl, keyToUse!, result.interactionId);

    if (options?.json) {
      jsonOut({
        success: true,
        interactionId: result.interactionId,
        sessionLabel: result.sessionLabel,
        instruction,
      });
    } else {
      success("Instruction received:");
      info(instruction);
    }
  } catch (err: any) {
    cliLogger.error("Pause-and-wait failed", err);
    error(`Network error: ${err.message}`);
    process.exit(1);
  }
}

export async function runWaitInstructionCommand(
  sessionLabel: string,
  options?: { json?: boolean },
) {
  cliLogger.info("Wait-instruction command started");

  if (!sessionLabel || !sessionLabel.trim()) {
    error("session-label is required and must be a non-empty kebab identifier.");
    process.exit(1);
  }

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(sessionLabel)) {
    error("session-label must be a simple kebab-case identifier (lowercase letters, numbers, hyphens).");
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
    info(`Waiting for instruction for session: ${sessionLabel}...`);
  }

  try {
    // First, find the interaction ID by session label, then poll
    while (true) {
      const response = await fetch(`${convexSiteUrl}/api/get-instruction`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keyToUse}`,
        },
        body: JSON.stringify({ sessionLabel }),
      });

      if (response.ok) {
        const result = await response.json() as { status: string; response: string | null; interactionId?: string };

        if (result.status === "responded" && result.response) {
          if (options?.json) {
            jsonOut({
              success: true,
              sessionLabel,
              interactionId: result.interactionId,
              instruction: result.response,
            });
          } else {
            success("Instruction received:");
            info(result.response);
          }
          return;
        }

        if (result.status === "consumed") {
          if (options?.json) {
            jsonOut({ success: false, error: "Interaction was consumed by another process." });
          } else {
            error("Interaction was consumed by another process. Use a unique session label and try again.");
          }
          process.exit(1);
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } catch (err: any) {
    cliLogger.error("Wait-instruction failed", err);
    error(`Network error: ${err.message}`);
    process.exit(1);
  }
}
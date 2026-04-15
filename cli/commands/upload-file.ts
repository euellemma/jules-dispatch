import * as fs from "fs";
import * as path from "path";

import { readHomeConfig } from "../config.js";
import { getConvexSiteUrl } from "../utils.js";
import { cliLogger } from "../utils/logger.js";
import { info, success, error, jsonOut } from "../utils/output.js";

const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const WAIT_POLL_INTERVAL_MS = 2000;
const WAIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export async function runUploadFileCommand(
  filePath: string,
  options?: { prompt?: string; caption?: string; json?: boolean; wait?: boolean },
) {
  cliLogger.info("Upload file command started");

  if (!fs.existsSync(filePath)) {
    error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    error(`Not a file: ${filePath}`);
    process.exit(1);
  }

  if (stats.size > MAX_SIZE_BYTES) {
    error(`File too large: ${formatFileSize(stats.size)} (max 20MB)`);
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
  const fileName = path.basename(filePath);

  if (!options?.json) {
    info(`Uploading: ${fileName} (${formatFileSize(stats.size)})`);
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), fileName);

    if (options?.prompt) {
      formData.append("prompt", options.prompt);
    }
    if (options?.caption) {
      formData.append("caption", options.caption);
    }

    const response = await fetch(`${convexSiteUrl}/api/upload-file`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${keyToUse}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      if (response.status === 401) {
        error("Authentication failed. Check your deploy key.");
      } else if (response.status === 413) {
        error(`File too large: ${errorBody}`);
      } else if (response.status === 400) {
        error(`Bad request: ${errorBody}`);
      } else {
        error(`Server error (${response.status}): ${errorBody}`);
      }
      process.exit(1);
    }

    const result = await response.json() as {
      success: boolean;
      fileId: string;
      filename: string;
      size: number;
      threadId: string;
      promptProcessed: boolean;
    };

    if (!result.success) {
      error("Failed to upload file.");
      process.exit(1);
    }

    // --wait: poll for agent response (only makes sense with --prompt)
    if (options?.wait && options?.prompt) {
      if (!options.json) {
        info("Generating...");
      }

      try {
        const agentResponse = await waitForResponse(convexSiteUrl, keyToUse!, result.threadId);
        if (options.json) {
          jsonOut({ success: true, threadId: result.threadId, fileId: result.fileId, filename: result.filename, response: agentResponse });
        } else {
          info(`Jules Dispatch: ${agentResponse}`);
        }
      } catch (waitErr: any) {
        if (options.json) {
          jsonOut({ success: true, threadId: result.threadId, fileId: result.fileId, filename: result.filename, response: null, error: waitErr.message });
        } else {
          error(waitErr.message);
        }
        process.exit(1);
      }
    } else if (options?.json) {
      jsonOut({ success: true, threadId: result.threadId, fileId: result.fileId, filename: result.filename, size: result.size, promptProcessed: result.promptProcessed });
    } else {
      success("File uploaded successfully.");
      info(`File: ${result.filename} (${formatFileSize(result.size)})`);
      info(`Thread: ${result.threadId}`);

      if (options?.prompt) {
        if (result.promptProcessed) {
          info("Prompt sent - bot is processing...");
        } else {
          info("Prompt queued (bot is busy).");
        }
      } else {
        info("File stored. Send a message to process it.");
      }
    }
  } catch (err: any) {
    cliLogger.error("Upload file failed", err);
    error(`Network error: ${err.message}`);
    process.exit(1);
  }
}

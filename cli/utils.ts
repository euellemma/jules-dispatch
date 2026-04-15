import * as fs from "fs";
import * as path from "path";
import { readHomeConfig, parseDeployKey } from "./config.js";

/**
 * Get the Convex site URL from environment or configuration.
 * Checks in order: JULES_DISPATCH_SITE_URL env var, .env.local file, deploy key.
 */
export function getConvexSiteUrl(config: ReturnType<typeof readHomeConfig>): string {
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

import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { printBanner, c, link, info } from "../ui.js";
import { readHomeConfig, writeHomeConfig, writeEnvLocal, readEnvLocal } from "../config.js";
import {
  runConvexDeploy,
  buildAndUploadWeb,
  setupTelegramWebhook,
  setConvexEnvVars,
  parseDeployKey,
} from "../utils/deploy.js";
import { promptForDeployKey } from "../steps/convex.js";

export async function runDeployCommand(): Promise<void> {
  const config = readHomeConfig();
  const cwd = process.cwd();
  
  // Prefer CWD if it's a valid project dir, otherwise use config path
  const isCwdValid = fs.existsSync(path.join(cwd, "convex")) && fs.existsSync(path.join(cwd, "package.json"));
  let installPath = isCwdValid ? cwd : config?.installPath;

  if (!installPath) {
    p.log.error(c.red("No Jules Dispatch installation found."));
    info("Run 'npx jules-dispatch' to set up first.");
    process.exit(1);
  }

  if (!fs.existsSync(installPath)) {
    p.log.error(c.red(`Installation not found: ${installPath}`));
    process.exit(1);
  }

  // If we're deploying from CWD but don't have a config yet, we should still allow it
  // but we'll need to prompt for keys or rely on environment.
  // For now, let's assume we need a config for the deploy key and other metadata.
  if (!config) {
    p.log.error(c.red("No configuration found (~/.jules-dispatch.json)."));
    info("Run 'npx jules-dispatch' to set up first.");
    process.exit(1);
  }

  printBanner();

  let deployKey = config.deployKey;

  if (!deployKey) {
    info("No deploy key saved yet.\n");
    const newDeployKey = await promptForDeployKey();

    if (!newDeployKey) {
      p.log.error(c.red("Deploy key required for production deployment."));
      process.exit(1);
    }

    deployKey = newDeployKey;
    config.deployKey = newDeployKey;
    config.updatedAt = new Date().toISOString();
    writeHomeConfig(config);
  }

  const keyInfo = parseDeployKey(deployKey);
  info(`Deploying to: ${keyInfo?.deploymentName || "unknown"}\n`);

  const s = p.spinner();
  s.start("Deploying to Convex...");

  const success = await runConvexDeploy(deployKey, installPath);

  if (success) {
    s.stop(c.green("Backend deployed successfully!"));

    // Set environment variables on the Convex deployment
    if (keyInfo) {
      s.start("Configuring deployment environment...");
      const localEnv = readEnvLocal(installPath);
      const envSuccess = setConvexEnvVars(installPath, {
        CONVEX_URL: keyInfo.convexUrl,
        CONVEX_SITE_URL: keyInfo.convexSiteUrl,
        ...localEnv,
      });
      if (envSuccess) {
        s.stop(c.green("Environment configured!"));
      } else {
        s.stop(c.yellow("Environment configuration had issues"));
        p.log.warn(c.yellow("Some env vars may not have been set. Run manually:"));
        info(`  npx convex env set CONVEX_URL=${keyInfo.convexUrl} --prod`);
        info(`  npx convex env set CONVEX_SITE_URL=${keyInfo.convexSiteUrl} --prod`);
      }
    }

    // Build and upload web UI
    console.log();
    s.start("Building and uploading web UI...");
    const webUploadSuccess = await buildAndUploadWeb(installPath);

      if (webUploadSuccess) {
        s.stop(c.green("Web UI deployed!"));
      } else {
        s.stop(c.yellow("Web UI build/upload failed"));
        p.log.warn(
          c.yellow("\n⚠️  Settings page may not work. You can retry with:"),
        );
        info(`  cd ${installPath}`);
        info("  npm run deploy:web");
      }

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
      p.log.info(`Dashboard: ${link(keyInfo.convexSiteUrl + "/settings")}`);
      console.log();
      p.log.message(c.bold("Next:"));
      info(`${c.dim("1.")} cd ${installPath} && npm run dev`);
    }
  } else {
    s.stop(c.red("Deployment failed"));
    p.log.error(
      c.red("\nDeployment failed. Check the output above for details."),
    );
    info("Common fixes:");
    info("  • Check your deploy key is valid");
    info("  • Ensure you have internet connectivity");
    info("  • Try running: npx convex deploy --yes");
    process.exit(1);
  }

  p.outro(c.green("✨ Deployment Complete!"));
}

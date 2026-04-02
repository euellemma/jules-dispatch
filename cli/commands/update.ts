import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { printBanner, c, link, info } from "../ui.js";
import { handleError } from "../errors.js";
import { readHomeConfig, writeHomeConfig, writeEnvLocal } from "../config.js";
import { downloadAndExtract } from "../utils/archive.js";
import {
  runConvexDeploy,
  buildAndUploadWeb,
  setupTelegramWebhook,
  parseDeployKey,
} from "../utils/deploy.js";
import { promptForDeployKey } from "../steps/convex.js";

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
          new Error(
            `npm install failed with code ${code}. Try running 'npm install' manually in the project directory`,
          ),
        );
      }
    });
  });
}

async function installWebDependencies(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const webPath = path.join(installPath, "web");
    if (!fs.existsSync(path.join(webPath, "package.json"))) {
      resolve();
      return;
    }

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
          new Error(
            `npm install in web/ failed with code ${code}. Try running 'npm install' manually in the web/ directory`,
          ),
        );
      }
    });
  });
}

export async function runUpdateCommand(): Promise<void> {
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

  printBanner();

  const s = p.spinner();
  s.start("Downloading latest code...");

  try {
    await downloadAndExtract(installPath);
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

    s.start("Installing web UI dependencies...");
    await installWebDependencies(installPath);
    s.stop("Web UI dependencies updated!");
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
        s.stop(c.green("Backend deployed successfully!"));

        // Build and upload web UI
        s.start("Building and uploading web UI...");
        const webUploadSuccess = await buildAndUploadWeb(installPath);

        if (webUploadSuccess) {
          s.stop(c.green("Web UI deployed!"));
        } else {
          s.stop(c.yellow("Web UI upload failed"));
          p.log.warn(
            c.yellow("\n⚠️  Settings page may not work. You can retry with:"),
          );
          info(`  cd ${installPath}`);
          info("  npm run deploy:web");
        }

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

          p.log.success(`Dashboard: ${link(keyInfo.convexSiteUrl + "/settings")}`);
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

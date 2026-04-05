import * as p from "@clack/prompts";
import c from "picocolors";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { WizardError } from "../errors.js";
import { downloadAndExtract } from "../utils/archive.js";
import { printStep } from "../ui.js";

export const DEFAULT_INSTALL_PATH = path.join(os.homedir(), "jules-dispatch");

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



export async function runStepLocation(existingPath?: string): Promise<string> {
  const defaultPath = existingPath || DEFAULT_INSTALL_PATH;
  const messagePrefix = existingPath
    ? "Installation path (found existing installation at this path - will be wiped)"
    : "Installation path";

  const installPath = await p.text({
    message: messagePrefix,
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
          value: "wipe",
          label: c.red("Wipe and start fresh"),
          hint: c.red("⚠️ Delete everything and start over"),
        },
        {
          value: "different",
          label: "Choose different location",
          hint: "Pick another directory",
        },
        { value: "cancel", label: "Cancel", hint: "Exit setup" },
      ],
      initialValue: "different",
    });

    if (p.isCancel(action) || action === "cancel") {
      process.exit(0);
    }

    if (action === "different") {
      // Recursively call to get a different path
      return runStepLocation();
    }

    if (action === "wipe") {
      const s = p.spinner();
      s.start("Wiping directory...");

      try {
        fs.rmSync(resolvedPath, { recursive: true, force: true });
        s.stop("Directory wiped!");
      } catch (error) {
        s.stop("Failed to wipe directory");
        throw new WizardError(
          `Failed to wipe directory: ${error}`,
          "location",
          true,
          "Check permissions or manually delete the directory",
        );
      }
    }
  }

  // Download scaffold
  printStep("Fetching code repository...");
  const s = p.spinner();
  s.start("Downloading repository...");

  try {
    await downloadAndExtract(resolvedPath);
    s.stop("Repository downloaded!");
  } catch (error) {
    s.stop("Failed to download repository");
    throw error;
  }

  return resolvedPath;
}

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export function isGitAvailable(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepo(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, ".git"));
}

const TEMPLATE_REPO = "https://github.com/euellemma/jules-dispatch.git";

export function cloneWithGit(installPath: string): Promise<void> {
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

export function pullLatest(installPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import { WizardError } from "../errors.js";
import { withRetry } from "./retry.js";

const ARCHIVE_URL =
  "https://github.com/euellemma/jules-dispatch/archive/refs/heads/main.tar.gz";

const LOCAL_DEV_SOURCE = process.env.JULES_LOCAL_DEV_SOURCE;

async function copyFromLocal(
  sourcePath: string,
  destPath: string,
): Promise<number> {
  if (!fs.existsSync(sourcePath)) {
    throw new WizardError(
      `Local source does not exist: ${sourcePath}`,
      "location",
      true,
      "Check JULES_LOCAL_DEV_SOURCE path",
    );
  }

  fs.mkdirSync(destPath, { recursive: true });

  const SKIP_NAMES = [".env.local", ".git"];
  const SKIP_DIRS = ["node_modules", "dist"];

  function shouldSkip(name: string, isDir: boolean): boolean {
    if (SKIP_NAMES.includes(name)) return true;
    if (isDir && SKIP_DIRS.includes(name)) return true;
    return false;
  }

  fs.cpSync(sourcePath, destPath, {
    recursive: true,
    filter: (src) => {
      const name = path.basename(src);
      const isDir = fs.statSync(src).isDirectory();
      return !shouldSkip(name, isDir);
    },
  });

  return 0;
}

export async function downloadAndExtract(
  installPath: string,
  onProgress?: (fileCount: number) => void,
): Promise<void> {
  let fileCount: number;

  if (LOCAL_DEV_SOURCE) {
    fileCount = await copyFromLocal(LOCAL_DEV_SOURCE, installPath);
  } else {
    const buf = await withRetry(
      async () => {
        const response = await fetch(ARCHIVE_URL);
        if (!response.ok) {
          throw response;
        }
        const arrayBuf = await response.arrayBuffer();
        return Buffer.from(arrayBuf);
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (attempt, error) => {
          console.warn(
            `⚠️  Download attempt ${attempt} failed. Retrying... (${error.message})`
          );
        },
      }
    ).catch((error) => {
      if (error instanceof Response) {
        throw new WizardError(
          `Failed to download: ${error.status} ${error.statusText}`,
          "location",
          true,
          "Check your internet connection and try again"
        );
      }
      throw new WizardError(
        `Failed to download: ${error instanceof Error ? error.message : String(error)}`,
        "location",
        true,
        "Check your internet connection and try again"
      );
    });

    fs.mkdirSync(installPath, { recursive: true });
    fileCount = extractTarGz(buf, installPath);
  }

  if (onProgress) {
    onProgress(fileCount);
  }
}

export function extractTarGz(buf: Buffer, destDir: string): number {
  const gunzip = zlib.createGunzip();
  gunzip.write(buf);
  gunzip.end();

  const decompressed = gunzip.read() as Buffer;
  let offset = 0;
  let fileCount = 0;

  while (offset < decompressed.length) {
    if (offset + 512 > decompressed.length) break;
    const header = decompressed.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    const nameLen = header[100] === 0 ? 0 : 100;
    let name = header.subarray(0, nameLen).toString("utf-8").replace(/\0/g, "");
    if (!name) break;

    const typeChar = header[156];
    const size =
      parseInt(header.subarray(124, 136).toString("utf-8").trim(), 8) || 0;

    offset += 512;

    const slashIdx = name.indexOf("/");
    if (slashIdx >= 0) {
      name = name.substring(slashIdx + 1);
    }
    if (!name) {
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    name = name.replace(/\\/g, "/");

    if (typeChar === 53 || name.endsWith("/")) {
      const dirPath = path.join(destDir, name);
      if (!dirPath.startsWith(destDir + path.sep)) {
        offset += Math.ceil(size / 512) * 512;
        continue;
      }
      fs.mkdirSync(dirPath, { recursive: true });
    } else if (typeChar === 48 || typeChar === 0) {
      const filePath = path.join(destDir, name);
      if (!filePath.startsWith(destDir + path.sep)) {
        offset += Math.ceil(size / 512) * 512;
        continue;
      }
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      if (size > 0) {
        const content = decompressed.subarray(offset, offset + size);
        fs.writeFileSync(filePath, content);
      } else {
        fs.writeFileSync(filePath, "");
      }
      fileCount++;
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return fileCount;
}

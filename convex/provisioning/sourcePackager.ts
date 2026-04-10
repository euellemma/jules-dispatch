"use node";
import * as zlib from "zlib";

const UPSTREAM_URL = "https://github.com/euellemma/jules-dispatch/archive/refs/heads/main.tar.gz";

export interface SourceFile {
  path: string;
  content: string;
}

export async function fetchUpstreamSource(): Promise<SourceFile[]> {
  const response = await fetch(UPSTREAM_URL);
  if (!response.ok) {
    throw new Error(`Failed to download upstream source: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const decompressed = zlib.gunzipSync(buffer);

  const files: SourceFile[] = [];
  let offset = 0;

  while (offset < decompressed.length) {
    if (offset + 512 > decompressed.length) break;
    const header = decompressed.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    let name = header.subarray(0, 100).toString("utf-8").replace(/\0/g, "");
    if (!name) {
      const size = parseInt(header.subarray(124, 136).toString("utf-8").trim(), 8) || 0;
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }

    const slashIdx = name.indexOf("/");
    if (slashIdx >= 0) {
      name = name.substring(slashIdx + 1);
    }
    if (!name) {
      const size = parseInt(header.subarray(124, 136).toString("utf-8").trim(), 8) || 0;
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }

    name = name.replace(/\\/g, "/");
    const typeChar = header[156];
    const size = parseInt(header.subarray(124, 136).toString("utf-8").trim(), 8) || 0;

    offset += 512;

    if (typeChar === 53 || name.endsWith("/")) {
    } else if (typeChar === 48 || typeChar === 0) {
      if (size > 0) {
        const content = decompressed.subarray(offset, offset + size).toString("utf-8");

        if (shouldIncludeFile(name, content)) {
          files.push({ path: name, content });
        }
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

function shouldIncludeFile(path: string, content: string): boolean {
  if (content.includes("\0")) return false;
  if (content.length > 1_000_000) return false;

  const skipPatterns = [
    ".env.local",
    ".env.production",
    "node_modules",
    ".git/",
    "dist/",
    "coverage/",
  ];

  for (const pattern of skipPatterns) {
    if (path.includes(pattern)) return false;
  }

  return true;
}

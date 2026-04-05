import type { VfsPathParts } from "./types";

/**
 * Convert any string to a URL-safe slug.
 * "Fix Auth Bug" -> "fix-auth-bug"
 * "My Feature v2!" -> "my-feature-v2"
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Build a unique, deterministic short name for a session.
 * Format: {slug}-{sessionId[0:5]}
 * "Fix Auth Bug" + "k8x2f..." -> "fix-auth-bug-k8x2f"
 */
export function makeUniqueShortName(
  baseName: string,
  julesSessionId: string,
): string {
  const slug = slugify(baseName) || "session";
  const suffix = julesSessionId.slice(0, 5);
  return `${slug}-${suffix}`;
}

/**
 * Parse a VFS path into its components.
 *
 * /uploads/foo.md            -> { root: "uploads", subPath: "foo.md" }
 * /uploads/_inbox/report.pdf -> { root: "uploads", subPath: "report.pdf", isInbox: true }
 * /sessions/fix-auth/files/src/login.ts -> { root: "sessions", sessionName: "fix-auth", subPath: "src/login.ts" }
 */
export function parseVfsPath(vfsPath: string): VfsPathParts {
  const cleaned = vfsPath.replace(/^\/+|\/+$/g, "");
  const segments = cleaned.split("/");

  if (segments[0] === "uploads") {
    if (segments[1] === "_inbox") {
      return {
        root: "uploads",
        subPath: segments.slice(2).join("/"),
        isInbox: true,
      };
    }
    return {
      root: "uploads",
      subPath: segments.slice(1).join("/"),
    };
  }

  if (segments[0] === "sessions") {
    const sessionName = segments[1] || "";
    // /sessions/{name}/files/{path...} or /sessions/{name} or /sessions/{name}/files/
    let subPath: string | undefined;
    if (segments.length > 3 && segments[2] === "files") {
      subPath = segments.slice(3).join("/");
    }
    return {
      root: "sessions",
      sessionName,
      subPath: subPath || undefined,
    };
  }

  throw new Error(`Invalid VFS path: ${vfsPath}`);
}

/**
 * Build a VFS path for an uploaded file.
 */
export function buildUploadPath(assignedName: string): string {
  return `/uploads/${assignedName}`;
}

/**
 * Build a VFS path for an unregistered (inbox) file.
 */
export function buildInboxPath(originalName: string): string {
  return `/uploads/_inbox/${originalName}`;
}

/**
 * Build a VFS path for a session output file.
 */
export function buildSessionFilePath(
  sessionName: string,
  filePath: string,
): string {
  return `/sessions/${sessionName}/files/${filePath}`;
}

/**
 * Get the directory path from a VFS path.
 * "/uploads/foo/bar.md" -> "/uploads/foo"
 * "/uploads/foo.md" -> "/uploads"
 */
export function dirname(vfsPath: string): string {
  const lastSlash = vfsPath.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return vfsPath.slice(0, lastSlash);
}

/**
 * Get the basename from a VFS path.
 * "/uploads/foo/bar.md" -> "bar.md"
 */
export function basename(vfsPath: string): string {
  const lastSlash = vfsPath.lastIndexOf("/");
  return vfsPath.slice(lastSlash + 1);
}

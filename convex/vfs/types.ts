import { v } from "convex/values";

// ============================================================================
// VFS Types
// ============================================================================

export type VfsSource = "upload" | "session-output";

export interface VfsEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  source: VfsSource;
  size?: number;
  storageId?: string;
  sourceId?: string;
  originalName?: string;
  caption?: string;
  status?: "unregistered" | "registered";
  sessionShortName?: string;
  filePath?: string;
}

export interface VfsPathParts {
  root: "uploads" | "sessions";
  sessionName?: string;
  subPath?: string;
  isInbox?: boolean;
}

export interface VfsReadResult {
  path: string;
  name: string;
  content: string;
  source: VfsSource;
}

// ============================================================================
// Zod Schemas for Tool Actions
// ============================================================================

export const kebabCaseRegex = /^[a-z0-9]+(-[a-z0-9]+)*\.[a-z0-9]+$/;

export const lsArgs = v.object({
  action: v.literal("ls"),
  path: v.optional(v.string()),
  depth: v.optional(v.number()),
});

export const readArgs = v.object({
  action: v.literal("read"),
  path: v.string(),
});

export const sendArgs = v.object({
  action: v.literal("send"),
  paths: v.union(v.string(), v.array(v.string())),
  asZip: v.optional(v.boolean()),
});

export const registerArgs = v.object({
  action: v.literal("register"),
  registrations: v.array(
    v.object({
      vfsPath: v.string(),
      assignedName: v.string(),
    }),
  ),
});

export const vfsActionArgs = v.union(lsArgs, readArgs, sendArgs, registerArgs);

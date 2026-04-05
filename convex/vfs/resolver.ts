import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { parseVfsPath, makeUniqueShortName } from "./pathUtils";

const resolvedFileValidator = v.union(
  v.object({
    storageId: v.string(),
    name: v.string(),
    source: v.union(v.literal("upload"), v.literal("session-output")),
  }),
  v.null(),
);

/**
 * Resolve a VFS path to a storage reference.
 * Returns { storageId, name, source } or null if not found.
 */
export const resolveVfsRead = internalQuery({
  args: {
    threadId: v.string(),
    vfsPath: v.string(),
  },
  returns: resolvedFileValidator,
  handler: async (ctx, args) => {
    const parts = parseVfsPath(args.vfsPath);

    if (parts.root === "uploads") {
      return await resolveUpload(ctx, args.threadId, parts);
    }

    if (parts.root === "sessions") {
      return await resolveSessionFile(ctx, args.threadId, parts);
    }

    return null;
  },
});

async function resolveUpload(
  ctx: QueryCtx,
  threadId: string,
  parts: ReturnType<typeof parseVfsPath>,
) {
  const files = await ctx.db
    .query("uploadedFiles")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .collect();

  for (const file of files) {
    if (parts.isInbox) {
      if (
        file.status === "unregistered" &&
        file.originalName === parts.subPath
      ) {
        return {
          storageId: file.storageId,
          name: file.originalName,
          source: "upload" as const,
        };
      }
    } else {
      if (file.status === "registered" && file.assignedName === parts.subPath) {
        return {
          storageId: file.storageId,
          name: file.assignedName || file.originalName,
          source: "upload" as const,
        };
      }
    }
  }

  return null;
}

async function resolveSessionFile(
  ctx: QueryCtx,
  threadId: string,
  parts: ReturnType<typeof parseVfsPath>,
) {
  if (!parts.sessionName || !parts.subPath) return null;

  // Find the session by shortName or julesSessionId
  const sessions = await ctx.db
    .query("julesSessions")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .collect();

  let targetSessionId: string | null = null;
  for (const session of sessions) {
    const name = session.shortName
      ? makeUniqueShortName(session.shortName, session.julesSessionId)
      : session.julesSessionId.slice(0, 8);
    if (
      name === parts.sessionName ||
      session.julesSessionId === parts.sessionName
    ) {
      targetSessionId = session.julesSessionId;
      break;
    }
  }

  if (!targetSessionId) return null;

  // Find the file in session outputs (latest wins)
  const outputs = await ctx.db
    .query("sessionOutputs")
    .withIndex("by_julesSessionId", (q) =>
      q.eq("julesSessionId", targetSessionId!),
    )
    .collect();

  let foundFile: { path: string; storageId: string } | null = null;
  for (const output of outputs) {
    if (output.extractedFiles) {
      for (const file of output.extractedFiles) {
        if (file.path === parts.subPath && file.storageId) {
          foundFile = { path: file.path, storageId: file.storageId };
        }
      }
    }
  }

  if (!foundFile) return null;

  return {
    storageId: foundFile.storageId,
    name: foundFile.path,
    source: "session-output" as const,
  };
}

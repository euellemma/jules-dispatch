import { internalQuery, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { VfsEntry } from "./types";
import { makeUniqueShortName, buildInboxPath, buildUploadPath, buildSessionFilePath } from "./pathUtils";

// Shared validators
const vfsEntryValidator = v.object({
  path: v.string(),
  name: v.string(),
  isDirectory: v.boolean(),
  source: v.union(v.literal("upload"), v.literal("session-output")),
  size: v.optional(v.number()),
  storageId: v.optional(v.string()),
  sourceId: v.optional(v.string()),
  originalName: v.optional(v.string()),
  caption: v.optional(v.string()),
  status: v.optional(v.union(v.literal("unregistered"), v.literal("registered"))),
  sessionShortName: v.optional(v.string()),
  filePath: v.optional(v.string()),
});

const registerResultValidator = v.object({
  originalName: v.string(),
  assignedName: v.string(),
  success: v.boolean(),
  error: v.optional(v.string()),
});

/**
 * List all VFS entries for a thread.
 * Merges uploaded files and session output files into a unified tree.
 */
export const listThreadVfs = internalQuery({
  args: {
    threadId: v.string(),
    vfsPath: v.optional(v.string()),
    depth: v.optional(v.number()),
  },
  returns: v.array(vfsEntryValidator),
  handler: async (ctx, args) => {
    const targetPath = args.vfsPath || "/";
    const entries: VfsEntry[] = [];

    // 1. Fetch uploaded files
    const uploads = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();

    // 2. Fetch sessions for this thread
    const sessions = await ctx.db
      .query("julesSessions")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();

    // 3. Build session entries with their outputs
    const sessionEntries: VfsEntry[] = [];
    for (const session of sessions) {
      const sessionName = session.shortName
        ? makeUniqueShortName(session.shortName, session.julesSessionId)
        : session.julesSessionId.slice(0, 8);

      const sessionDir: VfsEntry = {
        path: `/sessions/${sessionName}`,
        name: sessionName,
        isDirectory: true,
        source: "session-output",
        sessionShortName: sessionName,
      };

      // Fetch outputs for this session
      const outputs = await ctx.db
        .query("sessionOutputs")
        .withIndex("by_julesSessionId", (q) =>
          q.eq("julesSessionId", session.julesSessionId),
        )
        .collect();

      const fileEntries: VfsEntry[] = [];
      // Build latest file map (later outputs overwrite earlier)
      const latestFiles = new Map<string, string>();
      for (const output of outputs) {
        if (output.extractedFiles) {
          for (const file of output.extractedFiles) {
            if (file.storageId) {
              latestFiles.set(file.path, file.storageId);
            }
          }
        }
      }

      for (const [filePath, storageId] of latestFiles) {
        fileEntries.push({
          path: buildSessionFilePath(sessionName, filePath),
          name: filePath.split("/").pop() || filePath,
          isDirectory: false,
          source: "session-output",
          storageId,
          sessionShortName: sessionName,
          filePath,
        });
      }

      sessionEntries.push(sessionDir, ...fileEntries);
    }

    // 4. Build upload entries
    const inboxEntries: VfsEntry[] = [];
    const registeredEntries: VfsEntry[] = [];

    for (const file of uploads) {
      if (file.status === "unregistered") {
        inboxEntries.push({
          path: buildInboxPath(file.originalName),
          name: file.originalName,
          isDirectory: false,
          source: "upload",
          size: file.size,
          storageId: file.storageId,
          sourceId: file._id,
          originalName: file.originalName,
          caption: file.caption,
          status: "unregistered",
        });
      } else {
        const name = file.assignedName || file.originalName;
        registeredEntries.push({
          path: buildUploadPath(name),
          name,
          isDirectory: false,
          source: "upload",
          size: file.size,
          storageId: file.storageId,
          sourceId: file._id,
          originalName: file.originalName,
          caption: file.caption,
          status: "registered",
        });
      }
    }

    // 5. Filter by target path
    if (targetPath === "/" || targetPath === "") {
      // Root listing: show top-level directories
      if (uploads.length > 0) {
        entries.push({
          path: "/uploads",
          name: "uploads",
          isDirectory: true,
          source: "upload",
        });
      }
      if (sessionEntries.length > 0) {
        entries.push({
          path: "/sessions",
          name: "sessions",
          isDirectory: true,
          source: "session-output",
        });
      }
    } else if (targetPath === "/uploads") {
      // Show registered uploads + _inbox dir
      entries.push(...registeredEntries);
      if (inboxEntries.length > 0) {
        entries.push({
          path: "/uploads/_inbox",
          name: "_inbox",
          isDirectory: true,
          source: "upload",
        });
      }
    } else if (targetPath === "/uploads/_inbox") {
      entries.push(...inboxEntries);
    } else if (targetPath === "/sessions") {
      // Show session directories only
      for (const session of sessions) {
        const sessionName = session.shortName
          ? makeUniqueShortName(session.shortName, session.julesSessionId)
          : session.julesSessionId.slice(0, 8);
        entries.push({
          path: `/sessions/${sessionName}`,
          name: sessionName,
          isDirectory: true,
          source: "session-output",
          sessionShortName: sessionName,
        });
      }
    } else if (targetPath.startsWith("/sessions/")) {
      // Session file listing — include files AND a files/ subdirectory
      const sessionName = targetPath.split("/")[2];
      const matchingSession = sessionEntries.filter(
        (e) => e.sessionShortName === sessionName,
      );
      // Return files for this session
      const dirEntries = matchingSession.filter((e) => e.isDirectory);
      const fileEntries = matchingSession.filter((e) => !e.isDirectory);
      entries.push(...dirEntries);
      if (fileEntries.length > 0) {
        // Show files dir
        entries.push({
          path: `/sessions/${sessionName}/files`,
          name: "files",
          isDirectory: true,
          source: "session-output",
          sessionShortName: sessionName,
        });
      }
    } else if (targetPath.startsWith("/sessions/") && targetPath.includes("/files")) {
      // Actual file listing within a session's files/
      const sessionName = targetPath.split("/")[2];
      const fileEntries = sessionEntries.filter(
        (e) => e.sessionShortName === sessionName && !e.isDirectory,
      );
      entries.push(...fileEntries);
    }

    return entries;
  },
});

/**
 * Register (rename) uploaded files from the inbox.
 */
export const registerViaVfs = internalMutation({
  args: {
    threadId: v.string(),
    registrations: v.array(
      v.object({
        originalName: v.string(),
        assignedName: v.string(),
      }),
    ),
  },
  returns: v.array(registerResultValidator),
  handler: async (ctx, args) => {
    const results: Array<{
      originalName: string;
      assignedName: string;
      success: boolean;
      error?: string;
    }> = [];

    // Fetch all unregistered files once
    const unregisteredFiles = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_thread_and_status", (q) =>
        q.eq("threadId", args.threadId).eq("status", "unregistered"),
      )
      .collect();

    const fileMap = new Map(
      unregisteredFiles.map((f) => [f.originalName, f]),
    );

    // Validate all registrations first
    const validRegistrations: Array<{ file: typeof unregisteredFiles[0]; reg: typeof args.registrations[0] }> = [];
    for (const reg of args.registrations) {
      const file = fileMap.get(reg.originalName);
      if (!file) {
        results.push({
          originalName: reg.originalName,
          assignedName: reg.assignedName,
          success: false,
          error: `File not found in inbox: ${reg.originalName}`,
        });
      } else {
        validRegistrations.push({ file, reg });
      }
    }

    // Patch all valid registrations in parallel
    await Promise.all(
      validRegistrations.map(({ file, reg }) =>
        ctx.db.patch(file._id, {
          assignedName: reg.assignedName,
          status: "registered",
        }),
      ),
    );

    for (const { reg } of validRegistrations) {
      results.push({
        originalName: reg.originalName,
        assignedName: reg.assignedName,
        success: true,
      });
    }

    return results;
  },
});

/**
 * Delete uploaded files for a thread (cleanup).
 * Returns storage IDs for blob cleanup.
 */
export const deleteFilesForThread = internalMutation({
  args: { threadId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("uploadedFiles")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .collect();

    const storageIds: string[] = [];
    for (const f of files) {
      storageIds.push(f.storageId);
      await ctx.db.delete(f._id);
    }
    return storageIds;
  },
});

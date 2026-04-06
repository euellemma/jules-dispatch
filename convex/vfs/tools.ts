import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { kebabCaseRegex } from "./types";
import { parseVfsPath } from "./pathUtils";

export const vfs = createTool({
  description:
    "Unified file system for uploads and session outputs. Browse, read, send, and register files through a single namespace.\n" +
    "- ls: List directory contents (default: root /)\n" +
    "- read: Read file content by VFS path\n" +
    "- send: Send files to Telegram (supports zip bundling)\n" +
    "- register: Rename unregistered uploads from inbox (assigns kebab-case name)",
  inputSchema: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("ls"),
      path: z
        .string()
        .optional()
        .default("/")
        .describe(
          "Directory to list. Examples: /, /uploads/, /uploads/_inbox/, /sessions/, /sessions/fix-auth-bug/files/",
        ),
      depth: z
        .number()
        .optional()
        .default(1)
        .describe("How deep to expand (1 = immediate children only)."),
    }),
    z.object({
      action: z.literal("read"),
      path: z
        .string()
        .describe(
          "VFS path to the file. Examples: /uploads/sales-plan.md, /uploads/_inbox/report.pdf, /sessions/fix-auth/files/src/login.ts",
        ),
    }),
    z.object({
      action: z.literal("send"),
      paths: z
        .union([z.string(), z.array(z.string())])
        .describe(
          "File path(s) or a single directory path to send. Directories are sent as a ZIP.",
        ),
      asZip: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bundle files into a ZIP before sending."),
    }),
    z.object({
      action: z.literal("register"),
      registrations: z
        .array(
          z.object({
            vfsPath: z
              .string()
              .describe(
                "VFS path of the unregistered file, e.g. /uploads/_inbox/report.pdf",
              ),
            assignedName: z
              .string()
              .describe(
                "Clean kebab-case name with extension, e.g. q3-sales-report.md",
              ),
          }),
        )
        .describe("Files to register (rename from inbox)."),
    }),
  ]),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread.");

      switch (args.action) {
        case "ls":
          return await handleLs(ctx, args);
        case "read":
          return await handleRead(ctx, args);
        case "send":
          return await handleSend(ctx, args);
        case "register":
          return await handleRegister(ctx, args);
        default:
          return "Unknown VFS action.";
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[vfs] Error:`, msg);
      return `VFS error: ${msg}`;
    }
  },
});

// ============================================================================
// ls handler
// ============================================================================

async function handleLs(
  ctx: any,
  args: { path: string; depth: number },
): Promise<string> {
  console.log(`[vfs:ls] Listing '${args.path}' (depth=${args.depth})`);

  const entries = await ctx.runQuery(internal.vfs.db.listThreadVfs, {
    threadId: ctx.threadId,
    vfsPath: args.path,
    depth: args.depth,
  });

  if (entries.length === 0) {
    return `No files found at '${args.path}'.`;
  }

  let output = `Directory: ${args.path}\n\n`;
  for (const entry of entries) {
    const type = entry.isDirectory ? "[dir] " : "[file]";
    const size = entry.size ? ` (${Math.round(entry.size / 1024)}KB)` : "";
    const status = entry.status === "unregistered" ? " -- unregistered" : "";
    const caption = entry.caption ? ` Caption: ${entry.caption}` : "";
    output += `  ${type} ${entry.path}${size}${status}${caption}\n`;
  }

  return output.trim();
}

// ============================================================================
// read handler
// ============================================================================

async function handleRead(
  ctx: any,
  args: { path: string },
): Promise<string> {
  console.log(`[vfs:read] Reading '${args.path}'`);

  const resolved = await ctx.runQuery(internal.vfs.resolver.resolveVfsRead, {
    threadId: ctx.threadId,
    vfsPath: args.path,
  });

  if (!resolved) {
    return `File not found: ${args.path}`;
  }

  // Fetch content via action (needs ctx.storage which is only available in actions/mutations)
  const content = await ctx.runAction(internal.vfs.actions.fetchContent, {
    storageId: resolved.storageId as any,
  });

  return `[FILE: ${args.path}]\n${content}`;
}

// ============================================================================
// send handler
// ============================================================================

async function handleSend(
  ctx: any,
  args: { paths: string | string[]; asZip: boolean },
): Promise<string> {
  const paths = Array.isArray(args.paths) ? args.paths : [args.paths];
  console.log(`[vfs:send] Sending ${paths.length} path(s), asZip=${args.asZip}`);

  // Get the telegram chat ID for this thread
  const chatId = await ctx.runQuery(internal.users.db.getChatIdForThread, {
    threadId: ctx.threadId,
  });
  if (!chatId) {
    return "Error: No Telegram chat ID found for this thread.";
  }

  // Resolve all paths and fetch content
  const files: { path: string; content: string }[] = [];
  const notFound: string[] = [];

  for (const vfsPath of paths) {
    // Check if it's a directory
    const entries = await ctx.runQuery(internal.vfs.db.listThreadVfs, {
      threadId: ctx.threadId,
      vfsPath,
      depth: 10,
    });

    if (entries.length === 0) {
      // Try as a file
      const resolved = await ctx.runQuery(internal.vfs.resolver.resolveVfsRead, {
        threadId: ctx.threadId,
        vfsPath,
      });
      if (!resolved) {
        notFound.push(vfsPath);
        continue;
      }
      const content = await ctx.runAction(internal.vfs.actions.fetchContent, {
        storageId: resolved.storageId as any,
      });
      const filename = vfsPath.split("/").pop() || vfsPath;
      files.push({ path: filename, content });
    } else {
      // Directory: collect all files within
      const fileEntries = entries.filter((e: any) => !e.isDirectory);
      const fetches = fileEntries
        .filter((e: any) => e.storageId)
        .map(async (entry: any) => {
          const content = await ctx.runAction(internal.vfs.actions.fetchContent, {
            storageId: entry.storageId,
          });
          return { path: entry.filePath || entry.name, content };
        });
      files.push(...await Promise.all(fetches));
    }
  }

  if (notFound.length > 0) {
    return `File(s) not found: ${notFound.join(", ")}`;
  }

  if (files.length === 0) {
    return "No files to send.";
  }

  // Notify user
  await ctx.runAction(internal.sessions.actions.sendTelegramMessage, {
    threadId: ctx.threadId,
    message: "Sending files...",
  });

  // Send as ZIP or individual documents
  const hasDir = paths.some((p) => {
    const parts = parseVfsPath(p);
    return !parts.subPath;
  });

  if (args.asZip || (hasDir && files.length > 1)) {
    const dirName = paths.length === 1
      ? (paths[0]!.split("/").filter(Boolean).pop() || "files")
      : "files";
    const zipName = `${dirName}.zip`;
    console.log(`[vfs:send] Sending ${files.length} file(s) as ZIP`);
    const sendRes = await ctx.runAction(
      internal.tools.nodeActions.sendTelegramZipAction,
      { telegramChatId: chatId, files, filename: zipName },
    );
    if (!sendRes.success) {
      return `Error sending ZIP: ${sendRes.error}`;
    }
    return `Sent ${files.length} file(s) as ZIP.`;
  }

  for (const file of files) {
    const sendRes = await ctx.runAction(
      internal.tools.nodeActions.sendTelegramDocumentAction,
      {
        telegramChatId: chatId,
        fileContent: file.content,
        filename: file.path,
      },
    );
    if (!sendRes.success) {
      return `Error sending file '${file.path}': ${sendRes.error}`;
    }
  }

  return `Sent ${files.length} file(s) to Telegram.`;
}

// ============================================================================
// register handler
// ============================================================================

async function handleRegister(
  ctx: any,
  args: { registrations: Array<{ vfsPath: string; assignedName: string }> },
): Promise<string> {
  console.log(`[vfs:register] Registering ${args.registrations.length} file(s)`);

  // Validate assigned names
  for (const reg of args.registrations) {
    if (!kebabCaseRegex.test(reg.assignedName)) {
      return `Error: '${reg.assignedName}' is not valid kebab-case with extension. Use format like 'my-file.md'.`;
    }
  }

  // Extract original names from VFS paths
  const registrations = args.registrations.map((reg) => {
    const parts = parseVfsPath(reg.vfsPath);
    if (!parts.isInbox || !parts.subPath) {
      throw new Error(
        `Invalid inbox path: ${reg.vfsPath}. Must be /uploads/_inbox/{filename}`,
      );
    }
    return {
      originalName: parts.subPath,
      assignedName: reg.assignedName,
    };
  });

  const results = await ctx.runMutation(internal.vfs.db.registerViaVfs, {
    threadId: ctx.threadId,
    registrations,
  });

  let output = "";
  for (const r of results) {
    if (r.success) {
      output += `- ${r.originalName} -> /uploads/${r.assignedName}\n`;
    } else {
      output += `- ${r.originalName} -> FAILED: ${r.error}\n`;
    }
  }

  return output.trim();
}

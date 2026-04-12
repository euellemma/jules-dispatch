import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";

export const manage_memory = createTool({
  description:
    "Save durable information to persistent memory that survives across conversations. " +
    "Memory is injected into future turns, so keep it compact and focused on facts that will still matter later.\n\n" +
    "WHEN TO SAVE (do this proactively, don't wait to be asked):\n" +
    "- User corrects you or says 'remember this' / 'don't do that again'\n" +
    "- User shares a preference, habit, or personal detail (name, role, timezone, coding style)\n" +
    "FORMATTING:\n" +
    "- Write concise, objective facts\n" +
    "- Combine related facts into a single block using bullet points\n" +
    "- There is no required file format or YAML structure. Just save the raw factual knowledge.\n\n" +
    "PRIORITY: User preferences and corrections > environment facts > procedural knowledge. " +
    "The most valuable memory prevents the user from having to repeat themselves.\n\n" +
    "Do NOT save task progress, session outcomes, completed-work logs, or temporary TODO state to memory.\n\n" +
    "TARGETS:\n" +
    "- 'user': who the user is \u2014 name, role, preferences, communication style, pet peeves\n" +
    "- 'memory': your notes \u2014 environment facts, project conventions, tool quirks, lessons learned\n" +
    "- 'skills': your functional knowledge \u2014 how-tos for using specific native or executor tools, API nuances, and workflow steps\n\n" +
    "ACTIONS: add (new entry), replace (update existing \u2014 old_text identifies it), remove (delete \u2014 old_text identifies it).\n\n" +
    "SKIP: trivial/obvious info, things easily re-discovered, raw data dumps, and temporary task state.",
  inputSchema: z.object({
    action: z.enum(["add", "replace", "remove"]).describe("The action to perform."),
    target: z.enum(["memory", "user", "skills"]).describe(
      "Which memory store: 'memory' for personal notes, 'user' for user profile, 'skills' for tool how-tos.",
    ),
    content: z.string().optional().describe(
      "The entry content. Required for 'add' and 'replace'.",
    ),
    old_text: z.string().optional().describe(
      "Short unique substring identifying the entry to replace or remove.",
    ),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "No userId available. Memory requires a user context." });
      }

      if (args.action === "add") {
        if (!args.content) {
          return JSON.stringify({ success: false, error: "Content is required for 'add' action." });
        }
        return JSON.stringify(await ctx.runMutation(internal.memory.db.addEntry, {
          userId: ctx.userId,
          target: args.target,
          content: args.content,
        }));
      }

      if (args.action === "replace") {
        if (!args.old_text) {
          return JSON.stringify({ success: false, error: "old_text is required for 'replace' action." });
        }
        if (!args.content) {
          return JSON.stringify({ success: false, error: "content is required for 'replace' action." });
        }
        return JSON.stringify(await ctx.runMutation(internal.memory.db.replaceEntry, {
          userId: ctx.userId,
          target: args.target,
          oldText: args.old_text,
          newContent: args.content,
        }));
      }

      if (args.action === "remove") {
        if (!args.old_text) {
          return JSON.stringify({ success: false, error: "old_text is required for 'remove' action." });
        }
        return JSON.stringify(await ctx.runMutation(internal.memory.db.removeEntry, {
          userId: ctx.userId,
          target: args.target,
          oldText: args.old_text,
        }));
      }

      return JSON.stringify({ success: false, error: `Unknown action '${args.action}'. Use: add, replace, remove` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ success: false, error: msg });
    }
  },
});

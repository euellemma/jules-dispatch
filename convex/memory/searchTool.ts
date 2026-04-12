import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { components } from "../_generated/api";

export const search_history = createTool({
  description:
    "Search previous chat history and conversation logs for a specific concept, keyword, or past discussion. " +
    "Returns the actual transcript of the chat messages that matched the query. " +
    "Use this when you need to recall exact details that are missing from the current context or session summary.",
  inputSchema: z.object({
    query: z.string().describe("The keyword or topic to search for (e.g., 'github auth error')."),
    scope: z.enum(["all_threads", "current_thread"]).optional().default("all_threads").describe(
      "Search across all past chats ('all_threads', default) or just the active chat ('current_thread').",
    ),
    limit: z.number().optional().default(5).describe("Maximum number of historical messages to return."),
  }),
  execute: async (ctx, args): Promise<string> => {
    try {
      if (!ctx.userId) {
        return "Error: No userId available.";
      }

      const queryArgs: any = {
        text: args.query,
        limit: args.limit,
      };

      if (args.scope === "current_thread") {
        if (!ctx.threadId) {
          return "Error: No active thread available to search.";
        }
        queryArgs.threadId = ctx.threadId;
      } else {
        queryArgs.searchAllMessagesForUserId = ctx.userId;
      }

      const results = await ctx.runQuery((components as any).agent.messages.textSearch, queryArgs);

      if (!results || results.length === 0) {
        return `No history found for query: "${args.query}"`;
      }

      const transcript = results
        .reverse() // Display chronological order
        .map((m: any) => {
          let text = "[Unknown Content]";
          if (m.text) {
             text = m.text;
          } else if (Array.isArray(m.message?.content)) {
             text = m.message.content
               .filter((c: any) => c.type === "text")
               .map((c: any) => c.text)
               .join(" ");
          } else if (typeof m.message?.content === "string") {
             text = m.message.content;
          }
          const role = m.message?.role || "unknown";
          return `[${role.toUpperCase()}]: ${text}`;
        })
        .join("\n\n");

      return `Historical Transcript for "${args.query}":\n\n${transcript}`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error searching history: ${msg}`;
    }
  },
});

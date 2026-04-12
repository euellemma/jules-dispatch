import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import { logger } from "../utils/logger";

/**
 * execute_code — The "Super Tool" for Jules.
 */
export const execute_code = createTool({
  description: 
    "Execute TypeScript code in a secure, remote Daytona sandbox. " +
    "Use this for complex logic, data processing, or to call connected tools via the 'tools' proxy. " +
    "Example: return await tools.github.user.getAuthenticated();",
  inputSchema: z.object({
    code: z.string().describe("The TypeScript code to execute. Must return a value or a promise."),
  }),
  execute: async (ctx, args): Promise<string> => {
    const threadId = ctx.threadId || "global_user";
    try {
      logger.tool(`[execute_code] Sending code to Daytona`, { code: args.code }, { threadId });
      
      const result = await ctx.runAction(internal.executor.action.execute, {
        userId: threadId,
        code: args.code,
      });

      if (result.error) {
        logger.error("execute_code execution failed", new Error(result.error), { threadId });
        return `Execution Error: ${result.error}\n\nLogs:\n${(result.logs || []).join("\n")}`;
      }

      const formattedResult = typeof result.result === "string" 
        ? result.result 
        : JSON.stringify(result.result, null, 2);

      logger.tool(`[execute_code] Received result`, { result: formattedResult }, { threadId });
      
      return `Result:\n${formattedResult}\n\nLogs:\n${(result.logs || []).join("\n")}`;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("execute_code system error", err, { threadId });
      return `Unexpected system error: ${msg}`;
    }
  },
});

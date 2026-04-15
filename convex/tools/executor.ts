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
    "The sandbox has a 'tools' proxy for connected integrations. Always return values or promises: 'return await tools.github.user.getAuthenticated()'. " +
    "Discover available tools: 'return await tools.discover({query: 'intent'})'",
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
        let errOutput = `Execution Error: ${result.error}\n\nLogs:\n${(result.logs || []).join("\n")}`;
        const MAX_ERR_LENGTH = 20000;
        if (errOutput.length > MAX_ERR_LENGTH) {
          errOutput = errOutput.slice(0, MAX_ERR_LENGTH) + "\n\n...[TRUNCATED: Output too large.]";
        }
        return errOutput;
      }

      const formattedResult = typeof result.result === "string" 
        ? result.result 
        : JSON.stringify(result.result, null, 2);

      const MAX_LOG_LENGTH = 1000;
      const logFormattedResult = formattedResult && formattedResult.length > MAX_LOG_LENGTH 
        ? formattedResult.slice(0, MAX_LOG_LENGTH) + "... [TRUNCATED FOR LOGS]" 
        : formattedResult;

      logger.tool(`[execute_code] Received result`, { result: logFormattedResult }, { threadId });
      
      let outputString = `Result:\n${formattedResult}\n\nLogs:\n${(result.logs || []).join("\n")}`;
      const MAX_OUTPUT_LENGTH = 20000;
      if (outputString.length > MAX_OUTPUT_LENGTH) {
        outputString = outputString.slice(0, MAX_OUTPUT_LENGTH) + "\n\n...[TRUNCATED: Output too large. Please refine your code to return less data or paginate results.]";
      }
      return outputString;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("execute_code system error", err, { threadId });
      return `Unexpected system error: ${msg}`;
    }
  },
});

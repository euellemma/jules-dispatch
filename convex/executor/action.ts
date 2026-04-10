import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { makeDaytonaExecutor } from "./daytona";
import * as Effect from "effect/Effect";
import { logger } from "../utils/logger";

/**
 * execute — Internal action to run code in a Daytona sandbox.
 */
export const execute = internalAction({
  args: {
    userId: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const threadId = args.userId;
    logger.info("Daytona execution requested", { threadId, data: { codeLength: args.code.length } });

    // 1. Resolve Daytona API Key
    const user = await ctx.runQuery(internal.users.db.getProviderConfigByThreadId, { 
      threadId 
    }) as any;
    
    const apiKey = user?.daytonaApiKey || process.env.DAYTONA_API_KEY;
    
    if (!apiKey) {
      logger.error("Daytona API Key missing", new Error("No API key configured"), { threadId });
      return {
        result: null,
        error: "Daytona API Key not found. Please set DAYTONA_API_KEY in your environment or user settings.",
        logs: []
      };
    }

    // 2. Initialize the Daytona Executor
    const executor = makeDaytonaExecutor({
      apiKey,
      image: "node:20-slim",
    }, threadId, ctx);

    // 3. Tool Invoker (Stub)
    const invoker = {
      invoke: (input: { path: string; args: unknown }) => {
        logger.tool(`Host-side tool call attempted (Stub)`, input, { threadId });
        return Effect.fail(new Error(`Host-side tool calls for '${input.path}' are not yet implemented.`));
      }
    };

    try {
      const program = executor.execute(args.code, invoker);
      const result = await Effect.runPromise(program);
      
      if (result.error) {
        logger.error("Daytona execution failed", new Error(result.error), { threadId, data: { logs: result.logs } });
      } else {
        logger.info("Daytona execution completed", { threadId, data: { logsCount: result.logs?.length } });
      }
      
      return result;
    } catch (err: any) {
      logger.error("Execution engine crashed", err, { threadId });
      return {
        result: null,
        error: `Execution engine error: ${err.message}`,
        logs: []
      };
    }
  },
});

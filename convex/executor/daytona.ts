import { Daytona, type Sandbox } from "@daytonaio/sdk";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import crypto from "crypto";
import { internal } from "../_generated/api";
import type { 
  CodeExecutor, 
  ExecuteResult, 
  SandboxToolInvoker 
} from "./types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class DaytonaError extends Data.TaggedError("DaytonaError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// IPC Schemas
// ---------------------------------------------------------------------------

const IPC_PREFIX = "@@executor-ipc@@";

const WorkerToolCallMessage = Schema.Struct({
  type: Schema.Literal("tool_call"),
  requestId: Schema.String,
  toolPath: Schema.String,
  args: Schema.Unknown,
});

const WorkerCompletedMessage = Schema.Struct({
  type: Schema.Literal("completed"),
  result: Schema.Unknown,
  logs: Schema.optional(Schema.Array(Schema.String)),
});

const WorkerFailedMessage = Schema.Struct({
  type: Schema.Literal("failed"),
  error: Schema.String,
  logs: Schema.optional(Schema.Array(Schema.String)),
});

const WorkerMessage = Schema.Union(
  WorkerToolCallMessage,
  WorkerCompletedMessage,
  WorkerFailedMessage,
);

// ---------------------------------------------------------------------------
// Executor Implementation
// ---------------------------------------------------------------------------

export type DaytonaExecutorOptions = {
  apiKey: string;
  serverUrl?: string;
  image?: string;
  timeoutMs?: number;
};

/**
 * getOrCreateSandbox — Implements Sandbox Pooling.
 * Checks Convex for a cached sandbox, verifies it's still alive in Daytona,
 * and boots it if necessary.
 */
const getOrCreateSandbox = (
  daytona: Daytona, 
  userId: string, 
  image: string,
  ctx: any, // Convex internal action context
  threadId: string
): Effect.Effect<{ sandbox: Sandbox; ipcToken: string }, DaytonaError> => 
  Effect.gen(function* () {
    // 1. Check Convex for cached session
    const session = yield* Effect.tryPromise({
      try: () => ctx.runQuery(internal.executor.db.getSession, { userId }),
      catch: (e) => new DaytonaError({ message: "Failed to query executor sessions", cause: e }),
    });

    if (session && session.image === image) {
      try {
        logger.info("Checking cached sandbox", { threadId, data: { sandboxId: session.sandboxId } });
        const sandbox = await daytona.get(session.sandboxId);
        
        // Ensure it's started
        await sandbox.start();

        const ipcToken = session.ipcToken || crypto.randomUUID();
        
        // Refresh lastUsedAt and ensure token is stored
        await ctx.runMutation(internal.executor.db.upsertSession, {
          userId,
          sandboxId: sandbox.id,
          image,
          ipcToken,
        });
        
        return { sandbox, ipcToken };
      } catch (e) {
        logger.warn("Cached sandbox invalid or deleted, creating new one", { threadId, data: { sandboxId: session.sandboxId } });
        yield* Effect.tryPromise({
          try: () => ctx.runMutation(internal.executor.db.deleteSession, { userId }),
          catch: () => {}, // Ignore
        });
      }
    }

    // 2. Create New Sandbox
    logger.info("Creating fresh Daytona sandbox", { threadId, data: { image } });
    const newSandbox = yield* Effect.tryPromise({
      try: () => daytona.createSandbox({ image }),
      catch: (e) => new DaytonaError({ message: "Failed to create Daytona sandbox", cause: e }),
    });

    // 3. Configure Autostop (15 mins by default)
    yield* Effect.tryPromise({
      try: () => newSandbox.setAutostopInterval(15),
      catch: () => {}, // Non-critical
    });

    // 4. Cache in Convex
    const ipcToken = crypto.randomUUID();
    yield* Effect.tryPromise({
      try: () => ctx.runMutation(internal.executor.db.upsertSession, {
        userId,
        sandboxId: newSandbox.id,
        image,
        ipcToken,
      }),
      catch: (e) => new DaytonaError({ message: "Failed to cache executor session", cause: e }),
    });

    return { sandbox: newSandbox, ipcToken };
  });

export const makeDaytonaExecutor = (
  options: DaytonaExecutorOptions, 
  threadId: string,
  ctx: any // Convex internal action context
): CodeExecutor => {
  const daytona = new Daytona({
    apiKey: options.apiKey,
    serverUrl: options.serverUrl,
  });

  return {
    execute: (code, toolInvoker) =>
      Effect.gen(function* () {
        const image = options.image ?? "node:20-slim";
        const userId = threadId;

        // 1. Get or Create Warm Sandbox
        const { sandbox, ipcToken } = yield* getOrCreateSandbox(daytona, userId, image, ctx, threadId);

        // 2. Resolve Secrets for this user
        // We look for everything in the 'secrets' namespace
        const secretEntries = yield* Effect.tryPromise({
          try: () => ctx.runQuery(internal.executor.db.listKv, { userId, namespace: "secrets" }),
          catch: () => [], 
        });

        const envVars: Record<string, string> = {};
        for (const entry of (secretEntries || [])) {
          try {
            // entries in 'secrets' namespace are JSON stringified SecretRef objects
            const ref = JSON.parse(entry.value);
            const secretValue = await ctx.runQuery(internal.executor.db.getSecret, { userId, secretId: ref.id });
            
            if (secretValue) {
              // Convert the secret name to a standard ENV_VAR_NAME (e.g. "GitHub Token" -> "GITHUB_TOKEN")
              const envName = ref.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
              envVars[envName] = secretValue;
            }
          } catch (e) {
            logger.warn("Failed to resolve secret for injection", { threadId, data: { key: entry.key } });
          }
        }

        try {
          // 3. Wrap code in the worker shim for IPC
          // We now inject the CONVEX_SITE_URL so the worker can call back home.
          const convexSiteUrl = process.env.CONVEX_SITE_URL;
          
          if (!convexSiteUrl) {
            throw new Error("CONVEX_SITE_URL is not set in environment variables.");
          }

          const envVarsJson = JSON.stringify(JSON.stringify(envVars));

          const shim = `
const IPC_PREFIX = "@@executor-ipc@@";
const writeIpc = (msg) => console.log(IPC_PREFIX + JSON.stringify(msg));

// Mock process.env with the secrets resolved from Convex
const process = { env: JSON.parse(${envVarsJson}) };

const tools = new Proxy({}, {
  get: (target, prop) => {
    return async (args) => {
      try {
        // CALL BACK TO CONVEX IPC BRIDGE (uses token auth, not userId)
        const response = await fetch(${JSON.stringify(convexSiteUrl + "/executor/ipc")}, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipcToken: ${JSON.stringify(ipcToken)},
            toolPath: prop,
            args: args || {}
          })
        });

        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }

        return data;
      } catch (e) {
        writeIpc({ type: "failed", error: "IPC Bridge Error: " + e.message });
        throw e;
      }
    };
  }
});

(async () => {
  try {
    const result = await (async (tools, process) => {
      ${code}
    })(tools, process);
    writeIpc({ type: "completed", result });
  } catch (e) {
    writeIpc({ type: "failed", error: e.message });
  }
})();
`;

          // 3. Run in Daytona
          logger.info("Executing code in sandbox", { threadId, data: { sandboxId: sandbox.id } });
          const response = yield* Effect.tryPromise({
            try: () => sandbox.codeInterpreter.run(shim),
            catch: (e) => new DaytonaError({ message: "Daytona execution failed", cause: e }),
          });

          // 4. Parse results
          const logs: string[] = [];
          let result: unknown = null;
          let error: string | undefined = undefined;

          const lines = response.stdout.split("\n");
          for (const line of lines) {
            if (line.startsWith(IPC_PREFIX)) {
              const raw = line.slice(IPC_PREFIX.length);
              try {
                const msg = JSON.parse(raw);
                const decoded = Schema.decodeUnknownSync(WorkerMessage)(msg);
                
                if (decoded.type === "completed") {
                  result = decoded.result;
                } else if (decoded.type === "failed") {
                  error = decoded.error;
                } else if (decoded.type === "tool_call") {
                  logger.tool(`Sandbox tool call requested: ${decoded.toolPath}`, decoded.args, { threadId });
                  logs.push(`[tool_call] Requested ${decoded.toolPath}`);
                }
              } catch (e) {
                logger.error("Failed to parse IPC message", e as Error, { threadId, data: { line } });
                logs.push(`[error] Failed to parse IPC: ${line}`);
              }
            } else if (line.trim()) {
              logs.push(line);
            }
          }

          if (response.exitCode !== 0 && !error) {
            error = response.stderr || `Exit code ${response.exitCode}`;
          }

          return { result, error, logs };

        } catch (err: any) {
          return { result: null, error: err.message, logs: [] };
        }
        // Note: We NO LONGER delete the sandbox in 'finally' to support pooling.
      }).pipe(
        Effect.catchTag("DaytonaError", (e) => {
          logger.error("Daytona runtime error", e.cause as Error || e, { threadId });
          return Effect.succeed<ExecuteResult>({ result: null, error: e.message });
        })
      ),
  };
};

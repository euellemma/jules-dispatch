// @ts-nocheck
"use node";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";
import crypto from "crypto";
import { Buffer } from "buffer";
import { internal } from "../_generated/api";
import type { CodeExecutor, ExecuteResult } from "./types";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Debug Mode Configuration
// ---------------------------------------------------------------------------

const DEBUG_MODE = true; // Hardcoded to true for streaming logs by default

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
  threadId: string,
): Effect.Effect<{ sandbox: Sandbox; ipcToken: string }, DaytonaError> =>
  Effect.gen(function* () {
    // 1. Check Convex for cached session
    const session = yield* Effect.tryPromise({
      try: () => ctx.runQuery(internal.executor.db.getSession, { userId }),
      catch: (e) =>
        new DaytonaError({
          message: "Failed to query executor sessions",
          cause: e,
        }),
    });

    if (session && session.image === image) {
      try {
        logger.info("Checking cached sandbox", {
          threadId,
          data: { sandboxId: session.sandboxId },
        });
        const sandbox = yield* Effect.tryPromise({
          try: () => daytona.get(session.sandboxId),
          catch: (e) =>
            new DaytonaError({
              message: "Failed to get cached sandbox",
              cause: e,
            }),
        });

        // Ensure it's started
        yield* Effect.tryPromise({
          try: () => sandbox.start(),
          catch: (e) =>
            new DaytonaError({
              message: "Failed to start cached sandbox",
              cause: e,
            }),
        });

        const ipcToken = session.ipcToken || crypto.randomUUID();

        // Refresh lastUsedAt and ensure token is stored
        yield* Effect.tryPromise({
          try: () =>
            ctx.runMutation(internal.executor.db.upsertSession, {
              userId,
              sandboxId: sandbox.id,
              image,
              ipcToken,
            }),
          catch: (e) =>
            new DaytonaError({
              message: "Failed to refresh session",
              cause: e,
            }),
        });

        return { sandbox, ipcToken };
      } catch (e) {
        logger.warn(
          `Cached sandbox invalid or deleted, creating new one: ${e?.message}`,
          {
            threadId,
            data: { sandboxId: session.sandboxId },
          },
        );
        yield* Effect.tryPromise({
          try: () =>
            ctx.runMutation(internal.executor.db.deleteSession, { userId }),
          catch: () => {}, // Ignore
        });
      }
    }

    // 2. Create New Sandbox
    logger.info("Creating fresh Daytona sandbox", {
      threadId,
      data: { image },
    });
    const newSandbox = (yield* Effect.tryPromise({
      try: () => daytona.create({ image }),
      catch: (e) =>
        new DaytonaError({
          message: "Failed to create Daytona sandbox",
          cause: e,
        }),
    })) as unknown as Sandbox;

    // 3. Configure Autostop (15 mins by default)
    yield* Effect.tryPromise({
      try: () => newSandbox.setAutostopInterval(15),
      catch: () => {}, // Non-critical
    });

    // 4. Cache in Convex
    const ipcToken = crypto.randomUUID();
    yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.executor.db.upsertSession, {
          userId,
          sandboxId: newSandbox.id,
          image,
          ipcToken,
        }),
      catch: (e) =>
        new DaytonaError({
          message: "Failed to cache executor session",
          cause: e,
        }),
    });

    return { sandbox: newSandbox, ipcToken };
  });

// ---------------------------------------------------------------------------
// Streaming Execution with Real-time Logs
// ---------------------------------------------------------------------------

/**
 * executeWithStreaming — Executes code using session-based streaming.
 * Logs are emitted in real-time via callbacks to the Convex logger.
 */
const executeWithStreaming = (
  sandbox: Sandbox,
  shim: string,
  threadId: string,
): Effect.Effect<ExecuteResult, DaytonaError> =>
  Effect.gen(function* () {
    const sessionId = `exec-${crypto.randomUUID()}`;
    const logs: string[] = [];
    let result: unknown = null;
    let error: string | undefined = undefined;
    let ipcBuffer = ""; // Buffer for partial IPC messages

    logger.info("Starting streaming execution", { threadId, data: { sessionId } });

    try {
      // 1. Create session
      yield* Effect.tryPromise({
        try: () => sandbox.process.createSession(sessionId),
        catch: (e) => new DaytonaError({ message: "Failed to create session", cause: e }),
      });

      // 2. Write shim to file
      const shimPath = `/tmp/${sessionId}.js`;
      yield* Effect.tryPromise({
        try: () => sandbox.fs.uploadFiles([{
          source: Buffer.from(shim),
          destination: shimPath
        }]),
        catch: (e) => new DaytonaError({ message: "Failed to upload shim file", cause: e }),
      });

      // 3. Execute command async (Node.js execution)
      const command = yield* Effect.tryPromise({
        try: () =>
          sandbox.process.executeSessionCommand(sessionId, {
            command: `node ${shimPath}`,
            runAsync: true,
          }),
        catch: (e) => new DaytonaError({ message: "Failed to execute command", cause: e }),
      });

      logger.info("Command executing async", { threadId, data: { cmdId: command.cmdId } });

      let stdoutBuffer = "";

      // 4. Stream logs with real-time callbacks
      yield* Effect.tryPromise({
        try: () =>
          sandbox.process.getSessionCommandLogs(
            sessionId,
            command.cmdId!,
            (stdout) => {
              // Real-time stdout logging
              logger.info(`[sandbox stdout] ${stdout}`, { threadId });

              stdoutBuffer += stdout;

              // Parse IPC messages when we hit a newline boundary
              let newlineIndex;
              while ((newlineIndex = stdoutBuffer.indexOf("\n")) !== -1) {
                const line = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

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
                      logger.tool(`Sandbox tool call: ${decoded.toolPath}`, decoded.args, { threadId });
                      logs.push(`[tool_call] ${decoded.toolPath}`);
                    }
                  } catch (e) {
                    logger.error("Failed to parse IPC", e as Error, { threadId, data: { line } });
                  }
                } else if (line) {
                  logs.push(line);
                }
              }
            },
            (stderr) => {
              // Real-time stderr logging (no Error wrapper to avoid noisy stack traces per line)
              logger.warn(`[sandbox stderr] ${stderr}`, { threadId });
              logs.push(`[stderr] ${stderr}`);
            },
          ),
        catch: (e) => new DaytonaError({ message: "Log streaming failed", cause: e }),
      });

      logger.info("Streaming execution completed", { threadId, data: { hasResult: !!result, hasError: !!error } });

      return { result, error, logs };
    } catch (err: any) {
      logger.error("Streaming execution crashed", err, { threadId });
      return { result: null, error: err.message, logs };
    }
  });

export const makeDaytonaExecutor = (
  options: DaytonaExecutorOptions,
  threadId: string,
  ctx: any, // Convex internal action context
): CodeExecutor => {
  const daytona = new Daytona({
    apiKey: options.apiKey,
    serverUrl: options.serverUrl,
  });

  return {
    execute: (code, _) =>
      Effect.gen(function* () {
        const image = options.image ?? "node:20-slim";
        const userId = threadId;

        // 1. Get or Create Warm Sandbox
        const { sandbox, ipcToken } = yield* getOrCreateSandbox(
          daytona,
          userId,
          image,
          ctx,
          threadId,
        );

        // 2. Resolve Secrets for this user
        // Sync stores all secrets under "global_user"
        const globalUserId = "global_user";
        const secretEntries = yield* Effect.tryPromise({
          try: () =>
            ctx.runQuery(internal.executor.db.listKv, {
              userId: globalUserId,
              namespace: "secrets",
            }),
          catch: () => [],
        });

        const envVars: Record<string, string> = {};
        for (const entry of secretEntries || []) {
          try {
            // entries in 'secrets' namespace are JSON stringified SecretRef objects
            const ref = JSON.parse(entry.value);
            const secretValue = yield* Effect.tryPromise({
              try: () =>
                ctx.runQuery(internal.executor.db.getSecret, {
                  userId: globalUserId,
                  secretId: ref.id,
                }),
              catch: () => null,
            });

            if (secretValue) {
              // Convert the secret name to a standard ENV_VAR_NAME (e.g. "GitHub Token" -> "GITHUB_TOKEN")
              const envName = ref.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
              envVars[envName] = secretValue;
            }
          } catch (e) {
            logger.warn(
              `Failed to resolve secret for injection: ${e?.message}`,
              {
                threadId,
                data: { key: entry.key },
              },
            );
          }
        }

        try {
          // 3. Wrap code in the worker shim for IPC
          // We now inject the CONVEX_SITE_URL so the worker can call back home.
          const convexSiteUrl = process.env.CONVEX_SITE_URL;

          if (!convexSiteUrl) {
            throw new Error(
              "CONVEX_SITE_URL is not set in environment variables.",
            );
          }

          const envVarsJson = JSON.stringify(JSON.stringify(envVars));

          const shim = `
const IPC_PREFIX = "@@executor-ipc@@";
const writeIpc = (msg) => console.log(IPC_PREFIX + JSON.stringify(msg));

// Merge secrets from Convex into the real process.env (don't replace process object)
Object.assign(process.env, JSON.parse(${envVarsJson}));

const INTERNAL_PROPS = new Set(['toJSON', 'toString', 'valueOf', 'constructor', 'then', 'Symbol(Symbol.toPrimitive)', 'Symbol(Symbol.iterator)']);

function createToolProxy(path) {
  const fn = async (args) => {
    try {
      // CALL BACK TO CONVEX IPC BRIDGE (uses token auth, not userId)
      const response = await fetch(${JSON.stringify(convexSiteUrl + "/executor/ipc")}, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipcToken: ${JSON.stringify(ipcToken)},
          toolPath: path,
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

  return new Proxy(fn, {
    get: (target, prop) => {
      if (typeof prop === 'symbol' || INTERNAL_PROPS.has(prop)) return undefined;
      const newPath = path ? path + "." + String(prop) : String(prop);
      return createToolProxy(newPath);
    }
  });
}
const tools = createToolProxy("");

(async () => {
  try {
    const result = await (async (tools) => {
      ${code}
    })(tools);
    writeIpc({ type: "completed", result });
  } catch (e) {
    writeIpc({ type: "failed", error: e.message });
  }
})();
`;

          // 3. Run in Daytona (streaming or simple mode)
          logger.info("Executing code in sandbox", {
            threadId,
            data: { sandboxId: sandbox.id, debugMode: DEBUG_MODE },
          });

          let result: unknown = null;
          let error: string | undefined = undefined;
          let logs: string[] = [];

          if (DEBUG_MODE) {
            // Streaming mode: real-time logs via callbacks
            const streamingResult = yield* executeWithStreaming(sandbox, shim, threadId);
            result = streamingResult.result;
            error = streamingResult.error;
            logs = streamingResult.logs || [];
          } else {
            // Simple mode: wait for completion, get all logs at end
            const response = yield* Effect.tryPromise({
              try: () => sandbox.process.codeRun(shim),
              catch: (e) =>
                new DaytonaError({
                  message: "Daytona execution failed",
                  cause: e,
                }),
            });

            const lines = response.result.split("\n");
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
                    logger.tool(
                      `Sandbox tool call requested: ${decoded.toolPath}`,
                      decoded.args,
                      { threadId },
                    );
                    logs.push(`[tool_call] Requested ${decoded.toolPath}`);
                  }
                } catch (e) {
                  logger.error("Failed to parse IPC message", e as Error, {
                    threadId,
                    data: { line },
                  });
                  logs.push(`[error] Failed to parse IPC: ${line}`);
                }
              } else if (line.trim()) {
                logs.push(line);
              }
            }

            if (response.exitCode !== 0 && !error) {
              error = response.stderr || `Exit code ${response.exitCode}`;
            }
          }

          return { result, error, logs };
        } catch (err: any) {
          return { result: null, error: err.message, logs: [] };
        }
        // Note: We NO LONGER delete the sandbox in 'finally' to support pooling.
      }).pipe(
        Effect.catchTag("DaytonaError", (e) => {
          logger.error("Daytona runtime error", (e.cause as Error) || e, {
            threadId,
          });
          return Effect.succeed<ExecuteResult>({
            result: null,
            error: e.message,
          });
        }),
      ),
  };
};

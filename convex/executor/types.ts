import * as Effect from "effect/Effect";

/** Invoke a tool by path from inside a sandbox */
export interface SandboxToolInvoker {
  invoke(input: {
    path: string;
    args: unknown;
  }): Effect.Effect<unknown, unknown>;
}

/** Result of executing code in a sandbox */
export type ExecuteResult = {
  result: unknown;
  error?: string;
  logs?: string[];
};

/** Executes code in a sandboxed runtime with tool access */
export interface CodeExecutor {
  execute(
    code: string,
    toolInvoker: SandboxToolInvoker,
  ): Effect.Effect<ExecuteResult, unknown>;
}

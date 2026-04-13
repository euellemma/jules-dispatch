// @ts-nocheck
import { v } from "convex/values";
import { internalAction, httpAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
import { logger } from "../utils/logger";

import type { ActionCtx } from "../_generated/server";

// ---------------------------------------------------------------------------
// OpenAPI Invocation Types
// ---------------------------------------------------------------------------

interface OpenApiParameter {
  name: string;
  location: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: any;
}

interface OpenApiRequestBody {
  contentType: string;
  schema?: any;
}

interface OpenApiBinding {
  method: string;
  pathTemplate: string;
  parameters: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
}

interface OpenApiConfig {
  baseUrl: string;
  headers: Record<
    string,
    { type: "secret"; secretId: string; prefix?: string } | string
  >;
}

interface OpenApiToolDef {
  pluginKey: string;
  binding: OpenApiBinding;
  config: OpenApiConfig;
}

// ---------------------------------------------------------------------------
// MCP Invocation Types
// ---------------------------------------------------------------------------

interface McpToolDef {
  pluginKey: string;
  binding: {
    toolId: string;
    toolName: string;
    description: string;
    inputSchema: unknown;
  };
  sourceData: {
    transport: "remote" | "stdio";
    endpoint?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    headers?: Record<string, string>;
    auth?: {
      kind: "none" | "header" | "oauth2";
      headerName?: string;
      secretId?: string;
      prefix?: string;
      accessTokenSecretId?: string;
      refreshTokenSecretId?: string;
      tokenType?: string;
    };
  };
}

// ---------------------------------------------------------------------------
// GraphQL Invocation Types
// ---------------------------------------------------------------------------

interface GraphQlToolDef {
  pluginKey: string;
  binding: {
    operationName?: string;
    query: string;
    variablesSchema?: unknown;
  };
  sourceData: {
    endpoint: string;
    headers?: Record<
      string,
      { type: "secret"; secretId: string; prefix?: string } | string
    >;
  };
}

// ---------------------------------------------------------------------------
// Google Discovery Invocation Types
// ---------------------------------------------------------------------------

interface GoogleDiscoveryToolDef {
  pluginKey: string;
  binding: {
    method: string;
    pathTemplate: string;
    parameters: OpenApiParameter[];
    requestBody?: OpenApiRequestBody;
  };
  sourceData: {
    rootUrl: string;
    servicePath: string;
    auth: {
      kind: "none" | "apiKey" | "oauth2";
      apiKeySecretId?: string;
      accessTokenSecretId?: string;
      refreshTokenSecretId?: string;
      clientIdSecretId?: string;
      clientSecretSecretId?: string;
    };
  };
}

// ---------------------------------------------------------------------------
// OpenAPI Tool Invoker
// ---------------------------------------------------------------------------

function resolvePath(
  template: string,
  args: Record<string, unknown>,
  parameters: OpenApiParameter[],
): { path: string; missing: string[] } {
  let resolved = template;
  const missing: string[] = [];

  for (const param of parameters) {
    if (param.location !== "path") continue;
    const value =
      (args.params && typeof args.params === "object"
        ? (args.params as Record<string, unknown>)[param.name]
        : args[param.name]) ??
      (args.pathParams && typeof args.pathParams === "object"
        ? (args.pathParams as Record<string, unknown>)[param.name]
        : undefined);

    if (value === undefined || value === null) {
      if (param.required) missing.push(param.name);
    } else {
      resolved = resolved.replace(
        `{${param.name}}`,
        encodeURIComponent(String(value)),
      );
    }
  }

  const remainingPlaceholders = [...resolved.matchAll(/\{([^{}]+)\}/g)].map(
    (m) => m[1],
  );
  for (const name of remainingPlaceholders) {
    if (args[name] !== undefined && args[name] !== null) {
      resolved = resolved.replace(
        `{${name}}`,
        encodeURIComponent(String(args[name])),
      );
    }
  }

  return { path: resolved, missing };
}

function resolveQueryParams(
  args: Record<string, unknown>,
  parameters: OpenApiParameter[],
): URLSearchParams {
  const searchParams = new URLSearchParams();

  for (const param of parameters) {
    if (param.location !== "query") continue;
    const value =
      args[param.name] ??
      (args.query && typeof args.query === "object"
        ? (args.query as Record<string, unknown>)[param.name]
        : undefined);

    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(param.name, String(v)));
      } else {
        searchParams.set(param.name, String(value));
      }
    }
  }

  return searchParams;
}

function resolveHeaderParams(
  args: Record<string, unknown>,
  parameters: OpenApiParameter[],
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const param of parameters) {
    if (param.location !== "header") continue;
    if (param.name.toLowerCase() === "host") continue;

    const value =
      args[param.name] ??
      (args.headers && typeof args.headers === "object"
        ? (args.headers as Record<string, unknown>)[param.name]
        : undefined);

    if (value !== undefined && value !== null) {
      headers[param.name] = String(value);
    }
  }

  return headers;
}

async function resolveSecret(
  ctx: ActionCtx,
  userId: string,
  secretId: string,
): Promise<string | null> {
  return await ctx.runQuery(internal.executor.db.getSecret, {
    userId,
    secretId,
  });
}

async function resolveHeaders(
  configHeaders: Record<
    string,
    { type: "secret"; secretId: string; prefix?: string } | string
  >,
  ctx: ActionCtx,
  userId: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(configHeaders)) {
    if (typeof value === "string") {
      headers[name] = value;
    } else if (value.type === "secret") {
      const secret = await resolveSecret(ctx, userId, value.secretId);
      if (secret) {
        headers[name] = value.prefix ? `${value.prefix}${secret}` : secret;
      }
    }
  }

  return headers;
}

async function invokeOpenApiTool(
  ctx: ActionCtx,
  userId: string,
  toolDef: OpenApiToolDef,
  args: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}> {
  const { binding, config } = toolDef;
  const { path, missing: missingPath } = resolvePath(
    binding.pathTemplate,
    args,
    binding.parameters,
  );

  if (missingPath.length > 0) {
    return {
      success: false,
      error: `Missing required path parameters: ${missingPath.join(", ")}`,
    };
  }

  const queryParams = resolveQueryParams(args, binding.parameters);
  const headerParams = resolveHeaderParams(args, binding.parameters);
  const resolvedConfigHeaders = await resolveHeaders(
    config.headers ?? {},
    ctx,
    userId,
  );

  const url = new URL(config.baseUrl.replace(/\/$/, "") + path);
  queryParams.forEach((value, key) => url.searchParams.append(key, value));

  const requestInit: RequestInit = {
    method: binding.method.toUpperCase(),
    headers: {
      ...resolvedConfigHeaders,
      ...headerParams,
    },
  };

  if (
    binding.requestBody &&
    ["POST", "PUT", "PATCH"].includes(binding.method.toUpperCase())
  ) {
    const body = args.body ?? args.input ?? args;
    if (body && typeof body === "object") {
      requestInit.body = JSON.stringify(body);
      if (
        !requestInit.headers ||
        !(requestInit.headers as Record<string, string>)["Content-Type"]
      ) {
        (requestInit.headers as Record<string, string>)["Content-Type"] =
          "application/json";
      }
    }
  }

  try {
    const response = await fetch(url.toString(), requestInit);
    const contentType = response.headers.get("content-type") ?? "";
    let data: unknown = null;

    if (response.status !== 204) {
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }
    }

    if (response.ok) {
      return { success: true, data, status: response.status };
    } else {
      return { success: false, error: String(data), status: response.status };
    }
  } catch (err: any) {
    return { success: false, error: `HTTP request failed: ${err.message}` };
  }
}

async function invokeMcpTool(
  ctx: ActionCtx,
  userId: string,
  toolDef: McpToolDef,
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { binding, sourceData } = toolDef;

  if (!sourceData.endpoint) {
    return {
      success: false,
      error: "MCP tool has no endpoint configured (remote transport required).",
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (sourceData.headers) {
    for (const [name, value] of Object.entries(sourceData.headers)) {
      headers[name] = value;
    }
  }

  if (sourceData.auth?.kind === "oauth2") {
    const accessToken = await resolveSecret(
      ctx,
      userId,
      sourceData.auth.accessTokenSecretId!,
    );
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
  } else if (sourceData.auth?.kind === "header") {
    const secret = await resolveSecret(ctx, userId, sourceData.auth.secretId!);
    if (secret) {
      const prefix = sourceData.auth.prefix ?? "";
      headers[sourceData.auth.headerName ?? "Authorization"] =
        `${prefix}${secret}`;
    }
  }

  try {
    const response = await fetch(sourceData.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: binding.toolName, arguments: args },
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, data };
    } else {
      return { success: false, error: String(data) };
    }
  } catch (err: any) {
    return { success: false, error: `MCP tool call failed: ${err.message}` };
  }
}

async function invokeGraphQlTool(
  ctx: ActionCtx,
  userId: string,
  toolDef: GraphQlToolDef,
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const { binding, sourceData } = toolDef;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sourceData.headers) {
    for (const [name, value] of Object.entries(sourceData.headers)) {
      if (typeof value === "string") {
        headers[name] = value;
      } else if (value.type === "secret") {
        const secret = await resolveSecret(ctx, userId, value.secretId);
        if (secret) {
          headers[name] = value.prefix ? `${value.prefix}${secret}` : secret;
        }
      }
    }
  }

  try {
    const response = await fetch(sourceData.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: binding.query,
        operationName: binding.operationName,
        variables: args,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      if (data.errors) {
        return { success: false, error: JSON.stringify(data.errors) };
      }
      return { success: true, data: data.data };
    } else {
      return { success: false, error: String(data) };
    }
  } catch (err: any) {
    return {
      success: false,
      error: `GraphQL tool call failed: ${err.message}`,
    };
  }
}

async function invokeGoogleDiscoveryTool(
  ctx: ActionCtx,
  userId: string,
  toolDef: GoogleDiscoveryToolDef,
  args: Record<string, unknown>,
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}> {
  const { binding, sourceData } = toolDef;

  let urlPath = binding.pathTemplate;
  const queryParams = new URLSearchParams();

  for (const param of binding.parameters) {
    const value =
      args[param.name] ??
      (args.params as Record<string, unknown> | undefined)?.[param.name];
    if (value === undefined) continue;

    if (param.location === "path") {
      urlPath = urlPath.replace(
        `{${param.name}}`,
        encodeURIComponent(String(value)),
      );
    } else if (param.location === "query") {
      if (Array.isArray(value)) {
        value.forEach((v) => queryParams.append(param.name, String(v)));
      } else {
        queryParams.set(param.name, String(value));
      }
    }
  }

  const url = new URL(
    `${sourceData.rootUrl.replace(/\/$/, "")}/${sourceData.servicePath.replace(/^\//, "")}${urlPath}`,
  );
  url.search = queryParams.toString();

  const headers: Record<string, string> = {};

  if (sourceData.auth.kind === "apiKey") {
    const apiKey = await resolveSecret(
      ctx,
      userId,
      sourceData.auth.apiKeySecretId!,
    );
    if (apiKey) queryParams.set("key", apiKey);
  } else if (sourceData.auth.kind === "oauth2") {
    const accessToken = await resolveSecret(
      ctx,
      userId,
      sourceData.auth.accessTokenSecretId!,
    );
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let body: string | undefined;
  if (
    ["POST", "PUT", "PATCH"].includes(binding.method.toUpperCase()) &&
    binding.requestBody
  ) {
    body = JSON.stringify((args.body ?? args.input ?? args) as unknown);
    headers["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url.toString(), {
      method: binding.method.toUpperCase(),
      headers,
      body,
    });

    const contentType = response.headers.get("content-type") ?? "";
    let data: unknown = null;

    if (response.status !== 204) {
      data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    }

    if (response.ok) {
      return { success: true, data, status: response.status };
    } else {
      return { success: false, error: String(data), status: response.status };
    }
  } catch (err: any) {
    return { success: false, error: `Google API call failed: ${err.message}` };
  }
}

/**
 * handleIpcCall — The main router for tool calls coming from the sandbox.
 * Accepts an ipcToken to authenticate and derive the userId.
 */
export const handleIpcCall = internalAction({
  args: {
    ipcToken: v.string(),
    toolPath: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    // 0. Authenticate: resolve userId from ipcToken
    const session = await ctx.runQuery(internal.executor.db.getSessionByToken, {
      ipcToken: args.ipcToken,
    });

    if (!session) {
      logger.error(
        "IPC auth failed: invalid or expired token",
        new Error("Invalid ipcToken"),
        { data: { toolPath: args.toolPath } },
      );
      return {
        error:
          "Invalid or expired IPC token. The sandbox session may have expired.",
      };
    }

    const userId = session.userId;
    const threadId = userId;
    logger.tool(`IPC Tool Call: ${args.toolPath}`, args.args, { threadId });

    try {
      // 1. Check if this is a "Local" built-in tool first
      // We allow the sandbox to call Jules's own tools (vfs, research, etc.)
      const localTools: Record<string, any> = {
        vfs: internal.tools.nodeActions.vfs,
        research: internal.tools.index.research,
        // Add more local tools as needed
      };

      if (localTools[args.toolPath]) {
        logger.info(`Routing to local tool: ${args.toolPath}`, { threadId });
        return await ctx.runAction(localTools[args.toolPath], args.args);
      }

      // 2. Lookup in Synced External Tools (executor_kv)
      const toolValue = await ctx.runQuery(internal.executor.db.getKv, {
        userId,
        namespace: "tools",
        key: args.toolPath,
      });

      if (!toolValue) {
        throw new Error(
          `Tool '${args.toolPath}' not found. Did you run 'npx jules-dispatch sync'?`,
        );
      }

      const toolDef = JSON.parse(toolValue);
      logger.info(
        `Routing to synced tool: ${args.toolPath} (Plugin: ${toolDef.pluginKey})`,
        { threadId },
      );

      // 3. Plugin-specific logic
      if (toolDef.pluginKey === "openapi") {
        return await invokeOpenApiTool(ctx, userId, toolDef, args.args);
      }

      if (toolDef.pluginKey === "mcp") {
        return await invokeMcpTool(ctx, userId, toolDef, args.args);
      }

      if (toolDef.pluginKey === "graphql") {
        return await invokeGraphQlTool(ctx, userId, toolDef, args.args);
      }

      if (toolDef.pluginKey === "google-discovery") {
        return await invokeGoogleDiscoveryTool(ctx, userId, toolDef, args.args);
      }

      return {
        success: false,
        error: `Plugin '${toolDef.pluginKey}' is not yet supported in this environment.`,
      };
    } catch (err: any) {
      logger.error(`IPC Tool Call failed: ${args.toolPath}`, err, { threadId });
      return { error: err.message };
    }
  },
});

/**
 * testIpc — Public action to test the IPC bridge logic without a sandbox.
 * Intended for development only; will be removed before stable release.
 */
export const testIpc = action({
  args: {
    userId: v.string(),
    toolPath: v.string(),
    args: v.any(),
  },
  handler: async (ctx, args) => {
    // Look up a session for this userId and get its token
    const session = await ctx.runQuery(internal.executor.db.getSession, {
      userId: args.userId,
    });
    if (!session) {
      return {
        error: "No session found for this userId. Create a sandbox first.",
      };
    }
    return await ctx.runAction(internal.executor.ipc.handleIpcCall, {
      ipcToken: session.ipcToken,
      toolPath: args.toolPath,
      args: args.args,
    });
  },
});

/**
 * ipcEndpoint — The public HTTP entrance for the Daytona sandbox worker.
 * Authenticates via ipcToken and routes to handleIpcCall.
 */
export const ipcEndpoint = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { ipcToken, toolPath, args } = body;

    if (!ipcToken || !toolPath) {
      return new Response("Missing required fields: ipcToken and toolPath", {
        status: 400,
      });
    }

    const result = await ctx.runAction(internal.executor.ipc.handleIpcCall, {
      ipcToken,
      toolPath,
      args: args || {},
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

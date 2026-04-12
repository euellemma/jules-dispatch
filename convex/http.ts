import { httpRouter } from "convex/server";
import type { GenericActionCtx } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import { logger } from "./utils/logger";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import type {
  SaveProviderConfigBody,
  SaveApiKeyBody,
  TestConnectionBody,
} from "./types";
import { ipcEndpoint } from "./executor/ipc";
import {
  bulkSyncHttp,
  bulkSyncWithReplaceHttp,
  syncSecretsHttp,
} from "./executor/db";

const http = httpRouter();
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsResponse(body: unknown, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

type SettingsAuthCtx = Pick<GenericActionCtx<any>, "runQuery">;

async function requireValidSettingsSession(
  ctx: SettingsAuthCtx,
  token: string | null | undefined,
  missingTokenMessage = "Missing token",
  invalidSessionMessage = "Invalid or expired session",
): Promise<string | Response> {
  if (!token) {
    return corsResponse({ error: missingTokenMessage }, 400);
  }

  const telegramChatId = await ctx.runQuery(
    internal.users.db.validateAuthSession,
    {
      token,
    },
  );

  if (!telegramChatId) {
    return corsResponse({ error: invalidSessionMessage }, 401);
  }

  return telegramChatId;
}

// Preflight handlers
http.route({
  path: "/settings/api/config",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/settings/api/save",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/settings/api/save-jules",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/settings/api/save-exa",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/settings/api/test",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/settings/api/notifications",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});

// API: Get provider config (for React app)
http.route({
  path: "/settings/api/config",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");
      const auth = await requireValidSettingsSession(ctx, token);
      if (auth instanceof Response) {
        return auth;
      }

      const res = await ctx.runQuery(internal.users.db.getProviderConfig, {
        telegramChatId: auth,
      });

      const user = await ctx.runQuery(
        internal.users.db.getUserNotificationPreference,
        {
          telegramChatId: auth,
        },
      );

      return corsResponse({
        telegramChatId: auth,
        config: res.config,
        julesApiKey: res.julesApiKey,
        exaApiKey: res.exaApiKey,
        updateNotificationsEnabled: user,
      });
    } catch (error) {
      logger.error("[http] Config API error:", error);
      return corsResponse({ error: "Error loading config" }, 500);
    }
  }),
});

// API: Save Jules API Key
http.route({
  path: "/settings/api/save-jules",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as SaveApiKeyBody;
      const { token, apiKey } = body;
      const auth = await requireValidSettingsSession(
        ctx,
        token,
        "Missing token",
        "Invalid session",
      );
      if (auth instanceof Response) {
        return auth;
      }

      await ctx.runMutation(internal.users.db.updateJulesApiKey, {
        telegramChatId: auth,
        apiKey,
      });

      return corsResponse({ success: true });
    } catch (_error) {
      return corsResponse({ error: "Error saving key" }, 500);
    }
  }),
});

// API: Save Exa API Key
http.route({
  path: "/settings/api/save-exa",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as SaveApiKeyBody;
      const { token, apiKey } = body;
      const auth = await requireValidSettingsSession(
        ctx,
        token,
        "Missing token",
        "Invalid session",
      );
      if (auth instanceof Response) {
        return auth;
      }

      await ctx.runMutation(internal.users.db.updateExaApiKey, {
        telegramChatId: auth,
        apiKey,
      });

      return corsResponse({ success: true });
    } catch (_error) {
      return corsResponse({ error: "Error saving key" }, 500);
    }
  }),
});

// API: Save provider config
http.route({
  path: "/settings/api/save",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as SaveProviderConfigBody;
      const { token, endpoint, model, apiKey, sdkType } = body;
      const auth = await requireValidSettingsSession(ctx, token);
      if (auth instanceof Response) {
        return auth;
      }

      await ctx.runMutation(internal.users.db.updateProviderConfig, {
        telegramChatId: auth,
        endpoint: endpoint || "",
        model: model || "",
        apiKey: apiKey || "",
        sdkType:
          (sdkType as
            | "openai"
            | "anthropic"
            | "google"
            | "openai-compatible") || "openai-compatible",
      });

      try {
        await ctx.runAction(internal.api.telegram.sendChatMessage, {
          chatId: auth,
          message: `✅ <b>Provider Configured!</b>\nModel: <code>${model || "unknown"}</code>\nSDK: <code>${sdkType || "openai-compatible"}</code>`,
        });
      } catch (err) {
        logger.error("Failed to notify telegram:", err);
      }

      return corsResponse({ success: true });
    } catch (error) {
      logger.error("[http] Save config error:", error);
      return corsResponse({ error: "Error saving config" }, 500);
    }
  }),
});

// API: Test provider connection
http.route({
  path: "/settings/api/test",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as TestConnectionBody;
      const { token, endpoint, model, apiKey, sdkType } = body;
      const auth = await requireValidSettingsSession(ctx, token);
      if (auth instanceof Response) {
        return auth;
      }

      const result = await ctx.runAction(
        internal.users.actions.testConnection,
        {
          endpoint,
          model,
          apiKey,
          sdkType: sdkType as
            | "openai"
            | "anthropic"
            | "google"
            | "openai-compatible",
        },
      );

      return corsResponse(result);
    } catch (error) {
      logger.error("[http] Test connection error:", error);
      return corsResponse({ error: "Internal error" }, 500);
    }
  }),
});

// API: Save update notification preference
http.route({
  path: "/settings/api/notifications",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = (await request.json()) as {
        token: string;
        enabled: boolean;
      };
      const { token, enabled } = body;
      const auth = await requireValidSettingsSession(ctx, token);
      if (auth instanceof Response) {
        return auth;
      }

      await ctx.runMutation(internal.users.db.updateNotificationPreference, {
        telegramChatId: auth,
        enabled,
      });

      return corsResponse({ success: true });
    } catch (error) {
      logger.error("[http] Save notifications error:", error);
      return corsResponse(
        { error: "Error saving notification preference" },
        500,
      );
    }
  }),
});

// Telegram webhook
http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { processTelegramUpdate } = await import("./api/telegram");

      const update = await request.json();
      const result = await processTelegramUpdate(ctx, update);

      return new Response(JSON.stringify(result), { status: 200 });
    } catch (error) {
      logger.error("[http] Telegram webhook error:", error);
      return new Response("Error processing webhook", { status: 500 });
    }
  }),
});

// Executor IPC endpoint for Daytona sandbox tool calls
http.route({
  path: "/executor/ipc",
  method: "POST",
  handler: ipcEndpoint,
});

// Executor Bulk Sync endpoint (called from CLI with Bearer auth)
http.route({
  path: "/executor/sync",
  method: "POST",
  handler: bulkSyncHttp,
});

// Executor Bulk Sync with Replace (namespace-level replace semantics)
http.route({
  path: "/executor/sync/replace",
  method: "POST",
  handler: bulkSyncWithReplaceHttp,
});

// Executor Secrets Sync endpoint
http.route({
  path: "/executor/sync/secrets",
  method: "POST",
  handler: syncSecretsHttp,
});

http.route({
  path: "/api/llmCalls",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return corsResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const deployKey = authHeader.slice(7);
    const expectedKey = process.env.CONVEX_DEPLOY_KEY;
    if (!expectedKey || deployKey !== expectedKey) {
      return corsResponse({ error: "Invalid deploy key" }, 401);
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const calls = await ctx.runQuery(api["llmCalls/query"].listLlmCalls, { limit });

    return corsResponse({ llmCalls: calls });
  }),
});

// Serve static files at /settings/* with SPA fallback to index.html
// MUST be after all API routes so they take precedence
registerStaticRoutes(http, components.selfHosting, {
  pathPrefix: "/settings",
  spaFallback: true,
});

export default http;

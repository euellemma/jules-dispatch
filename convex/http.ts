import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal, components } from "./_generated/api";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import type {
  SaveProviderConfigBody,
  SaveApiKeyBody,
  TestConnectionBody,
  TelegramUpdate,
} from "./types";

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

// Preflight handlers
http.route({ path: "/settings/api/config", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })) });
http.route({ path: "/settings/api/save", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })) });
http.route({ path: "/settings/api/save-jules", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })) });
http.route({ path: "/settings/api/save-exa", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })) });
http.route({ path: "/settings/api/test", method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })) });

// API: Get provider config (for React app)
http.route({
  path: "/settings/api/config",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get("token");

      if (!token) {
        return corsResponse({ error: "Missing token" }, 400);
      }

      const telegramChatId = await ctx.runQuery(internal.users.db.validateAuthSession, {
        token,
      });

      if (!telegramChatId) {
        return corsResponse({ error: "Invalid or expired session" }, 401);
      }

      const res = await ctx.runQuery(internal.users.db.getProviderConfig, {
        telegramChatId,
      });

      return corsResponse({
        telegramChatId,
        config: res.config,
        julesApiKey: res.julesApiKey,
        exaApiKey: res.exaApiKey,
      });
    } catch (error) {
      console.error("[http] Config API error:", error);
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

      const telegramChatId = await ctx.runQuery(internal.users.db.validateAuthSession, {
        token,
      });

      if (!telegramChatId) {
        return corsResponse({ error: "Invalid session" }, 401);
      }

      await ctx.runMutation(internal.users.db.updateJulesApiKey, {
        telegramChatId,
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

      const telegramChatId = await ctx.runQuery(internal.users.db.validateAuthSession, {
        token,
      });

      if (!telegramChatId) {
        return corsResponse({ error: "Invalid session" }, 401);
      }

      await ctx.runMutation(internal.users.db.updateExaApiKey, {
        telegramChatId,
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

      if (!token) {
        return corsResponse({ error: "Missing token" }, 400);
      }

      const telegramChatId = await ctx.runQuery(internal.users.db.validateAuthSession, {
        token,
      });

      if (!telegramChatId) {
        return corsResponse({ error: "Invalid or expired session" }, 401);
      }

      await ctx.runMutation(internal.users.db.updateProviderConfig, {
        telegramChatId,
        endpoint: endpoint || "",
        model: model || "",
        apiKey: apiKey || "",
        sdkType: (sdkType as "openai" | "anthropic" | "google" | "openai-compatible") || "openai-compatible",
      });

      try {
        await ctx.runAction(internal.api.telegram.sendChatMessage, {
          chatId: telegramChatId,
          message: `✅ <b>Provider Configured!</b>\nModel: <code>${model || "unknown"}</code>\nSDK: <code>${sdkType || "openai-compatible"}</code>`,
        });
      } catch (err) {
        console.error("Failed to notify telegram:", err);
      }

      return corsResponse({ success: true });
    } catch (error) {
      console.error("[http] Save config error:", error);
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

      if (!token) {
        return corsResponse({ error: "Missing token" }, 400);
      }

      const telegramChatId = await ctx.runQuery(internal.users.db.validateAuthSession, {
        token,
      });

      if (!telegramChatId) {
        return corsResponse({ error: "Invalid or expired session" }, 401);
      }

      const result = await ctx.runAction(internal.users.actions.testConnection, {
        endpoint,
        model,
        apiKey,
        sdkType: sdkType as "openai" | "anthropic" | "google" | "openai-compatible",
      });

      return corsResponse(result);
    } catch (error) {
      console.error("[http] Test connection error:", error);
      return corsResponse({ error: "Internal error" }, 500);
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
      console.error("[http] Telegram webhook error:", error);
      return new Response("Error processing webhook", { status: 500 });
    }
  }),
});

// Internal API for local polling bot (not Telegram webhook).
// Accepts a structured payload instead of raw Telegram update JSON.
http.route({
  path: "/bot/message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { processTelegramUpdate } = await import("./api/telegram");

      const body = (await request.json()) as {
        chatId?: string;
        text?: string;
        document?: { fileId: string; fileName: string; fileSize: number; caption?: string };
        callbackQuery?: { queryId: string; data: string; chatId: string; messageId: number };
      };

      // Validate: must have at least one payload field
      if (!body.chatId && !body.callbackQuery) {
        return new Response(JSON.stringify({ success: false, error: "Missing chatId or callbackQuery" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Build a Telegram-compatible update from the internal payload
      let update: TelegramUpdate;

      if (body.callbackQuery) {
        update = {
          callback_query: {
            id: body.callbackQuery.queryId,
            data: body.callbackQuery.data,
            from: { id: Number(body.callbackQuery.chatId) },
            message: {
              message_id: body.callbackQuery.messageId,
              chat: { id: Number(body.callbackQuery.chatId) },
            },
          },
        };
      } else if (body.document) {
        update = {
          message: {
            message_id: Date.now(),
            chat: { id: Number(body.chatId) },
            document: {
              file_id: body.document.fileId,
              file_name: body.document.fileName,
              file_size: body.document.fileSize,
            },
            caption: body.document.caption,
          },
        };
      } else {
        update = {
          message: {
            message_id: Date.now(),
            chat: { id: Number(body.chatId) },
            text: body.text || "",
          },
        };
      }

      const result = await processTelegramUpdate(ctx, update);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("[http] Bot message error:", error);
      return new Response(JSON.stringify({ success: false, error: "Internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }),
});

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async (_ctx, _request) => {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// Serve static files at /settings/* with SPA fallback to index.html
// MUST be after all API routes so they take precedence
registerStaticRoutes(http, components.selfHosting, {
  pathPrefix: "/settings",
  spaFallback: true,
});

export default http;

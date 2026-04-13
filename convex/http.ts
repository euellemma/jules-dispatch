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
import { escapeMdv2 } from "./utils/telegramFormat";
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
http.route({
  path: "/api/send-message",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/api/upload-file",
  method: "OPTIONS",
  handler: httpAction(
    async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
  ),
});
http.route({
  path: "/api/get-response",
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

      // Get singleton bot config (saves DB read)
      const config = await ctx.runQuery(internal.config.botConfig.getConfig, {});

      const user = await ctx.runQuery(
        internal.users.db.getUserNotificationPreference,
        {
          telegramChatId: auth,
        },
      );

      return corsResponse({
        telegramChatId: auth,
        config: config?.providerConfig,
        julesApiKey: config?.julesApiKey,
        exaApiKey: config?.exaApiKey,
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

      // Update singleton bot config (not per-user)
      await ctx.runMutation(internal.config.botConfig.updateConfig, {
        julesApiKey: apiKey,
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

      // Update singleton bot config (not per-user)
      await ctx.runMutation(internal.config.botConfig.updateConfig, {
        exaApiKey: apiKey,
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

      // Update singleton bot config (not per-user)
      await ctx.runMutation(internal.config.botConfig.updateConfig, {
        providerConfig: {
          endpoint: endpoint || "",
          model: model || "",
          apiKey: apiKey || "",
          sdkType:
            (sdkType as
              | "openai"
              | "anthropic"
              | "google"
              | "openai-compatible") || "openai-compatible",
        }
      });

      try {
        const escapeMdv2 = (text: string) => text.replace(/([_\*\[\]\(\)~`>#+\-=|{}\.!])/g, '\\$1');
        await ctx.runAction(internal.api.telegram.sendChatMessage, {
          chatId: auth,
          message: `✅ *Provider Configured!*\nModel: \`${escapeMdv2(model || "unknown")}\`\nSDK: \`${escapeMdv2(sdkType || "openai-compatible")}\``,
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
    const authError = await verifyDeployKey(request);
    if (authError) return authError;

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const calls = await ctx.runQuery(api["llmCalls/query"].listLlmCalls, { limit });

    return corsResponse({ llmCalls: calls });
  }),
});

// Helper to verify deploy key
async function verifyDeployKey(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return corsResponse({ error: "Missing or invalid Authorization header" }, 401);
  }

  const deployKey = authHeader.slice(7);
  const expectedKey = process.env.CONVEX_DEPLOY_KEY;
  if (!expectedKey || deployKey !== expectedKey) {
    return corsResponse({ error: "Invalid deploy key" }, 401);
  }

  return null;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// API: Send message to bot
http.route({
  path: "/api/send-message",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify deploy key
      const authError = await verifyDeployKey(request);
      if (authError) return authError;

      // Get user
      const user = await ctx.runQuery(internal.users.db.getAnyExistingUser);
      if (!user) {
        return corsResponse({ error: "No user configured" }, 400);
      }
      const telegramChatId = user.telegramChatId;

      // Parse body
      const body = (await request.json()) as { message?: string };
      const message = body.message?.trim();

      if (!message) {
        return corsResponse({ error: "Missing message" }, 400);
      }

      // Get or create thread
      const threadId = await ctx.runMutation(
        internal.users.db.getOrCreateUserThread,
        { telegramChatId }
      );

      // Queue message (mark as from API)
      await ctx.runMutation(internal.users.db.appendPendingMessage, {
        threadId,
        text: message + " [sent through API]",
      });

      // Reset failures
      await ctx.runMutation(internal.users.db.resetConsecutiveFailures, {
        telegramChatId,
      });

      // Always trigger queue processing - self-draining model
      await ctx.scheduler.runAfter(
        0,
        internal.api.telegram.processMessageQueue,
        { threadId, telegramChatId }
      );

      return corsResponse({
        success: true,
        threadId,
        agentTriggered: true,
      });
    } catch (error) {
      logger.error("[http] Send message error:", error);
      return corsResponse({ error: "Internal error" }, 500);
    }
  }),
});

// API: Get latest agent response for a thread
http.route({
  path: "/api/get-response",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify deploy key
      const authError = await verifyDeployKey(request);
      if (authError) return authError;

      // Parse body
      const body = (await request.json()) as { threadId?: string };
      if (!body.threadId) {
        return corsResponse({ error: "Missing threadId" }, 400);
      }

      // Query agent messages for this thread — get the latest assistant message
      const msgResult = await ctx.runQuery(
        (components as any).agent.messages.listMessagesByThreadId,
        {
          threadId: body.threadId,
          order: "desc",
          statuses: ["success"],
          paginationOpts: { numItems: 20, cursor: null },
        },
      );

      const messages: any[] = msgResult.page ?? [];

      // Find the most recent assistant message
      for (const msg of messages) {
        const role = msg.message?.role;
        if (role === "assistant") {
          let text = "";
          if (typeof msg.message.content === "string") {
            text = msg.message.content;
          } else if (Array.isArray(msg.message.content)) {
            text = msg.message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("");
          }
          if (text.trim()) {
            return corsResponse({ response: text.trim() });
          }
        }
      }

      // No assistant response yet
      return corsResponse({ response: null });
    } catch (error) {
      logger.error("[http] Get response error:", error);
      return corsResponse({ error: "Internal error" }, 500);
    }
  }),
});

// API: Upload file to bot
http.route({
  path: "/api/upload-file",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Verify deploy key
      const authError = await verifyDeployKey(request);
      if (authError) return authError;

      // Get user
      const user = await ctx.runQuery(internal.users.db.getAnyExistingUser);
      if (!user) {
        return corsResponse({ error: "No user configured" }, 400);
      }
      const telegramChatId = user.telegramChatId;

      // Parse multipart form
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const prompt = (formData.get("prompt") as string | null)?.trim();
      const caption = (formData.get("caption") as string | null)?.trim();

      if (!file) {
        return corsResponse({ error: "Missing file" }, 400);
      }

      // Check file size (20MB limit)
      const MAX_SIZE_BYTES = 20 * 1024 * 1024;
      if (file.size > MAX_SIZE_BYTES) {
        return corsResponse(
          { error: `File exceeds 20MB limit (${formatFileSize(file.size)})` },
          413
        );
      }

      // Get or create thread
      const threadId = await ctx.runMutation(
        internal.users.db.getOrCreateUserThread,
        { telegramChatId }
      );

      // Store file
      const storageId = await ctx.storage.store(file);

      // Save file metadata with cleanup on failure
      try {
        await ctx.runMutation(internal["files/db"].addUploadedFile, {
          threadId,
          storageId,
          originalName: file.name,
          caption,
          size: file.size,
        });
      } catch (dbError) {
        // Clean up orphaned storage if DB write fails
        logger.error("[http] Failed to save file metadata, cleaning up storage:", dbError);
        await ctx.storage.delete(storageId);
        throw dbError;
      }

      // Send Telegram notification (escape user input for MarkdownV2)
      const sizeStr = formatFileSize(file.size);
      const safeFileName = escapeMdv2(file.name);
      const safeCaption = caption ? escapeMdv2(caption) : null;
      let notification = `📎 Got a new file via API: ${safeFileName} (${sizeStr})`;
      if (safeCaption) {
        notification += `\n"${safeCaption}"`;
      }

      try {
        await ctx.runAction(internal.api.telegram.sendChatMessage, {
          chatId: telegramChatId,
          message: notification,
          parseMode: "MarkdownV2",
        });
      } catch (err) {
        logger.error("[http] Failed to send Telegram notification:", err);
      }

      // Process prompt if provided
      let promptProcessed = false;
      if (prompt) {
        await ctx.runMutation(internal.users.db.appendPendingMessage, {
          threadId,
          text: prompt + " [sent through API]",
        });

        await ctx.runMutation(internal.users.db.resetConsecutiveFailures, {
          telegramChatId,
        });

        // Always trigger queue processing - self-draining model
        await ctx.scheduler.runAfter(
          0,
          internal.api.telegram.processMessageQueue,
          { threadId, telegramChatId }
        );
        promptProcessed = true;
      }

      return corsResponse({
        success: true,
        fileId: storageId,
        filename: file.name,
        size: file.size,
        threadId,
        promptProcessed,
      });
    } catch (error) {
      logger.error("[http] Upload file error:", error);
      return corsResponse({ error: "Internal error" }, 500);
    }
  }),
});

// Serve OpenAPI spec for Executor integration
// Allows private repo users to use their Convex site URL for source detection
http.route({
  path: "/openapi.json",
  method: "GET",
  handler: httpAction(async () => {
    const spec = {
      openapi: "3.0.3",
      info: {
        title: "Jules Dispatch API",
        description: "API for sending messages and uploading files to the Jules Dispatch bot",
        version: "1.0.0"
      },
      servers: [
        {
          url: process.env.CONVEX_SITE_URL || "{convexSiteUrl}",
          description: "This Convex deployment"
        }
      ],
      paths: {
        "/api/send-message": {
          post: {
            operationId: "sendMessage",
            summary: "Send a message to the Jules bot",
            description: "Sends a text message to the Jules Dispatch bot",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" }
                    },
                    required: ["message"]
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Message sent successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean" },
                        threadId: { type: "string" },
                        agentTriggered: { type: "boolean" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        "/api/upload-file": {
          post: {
            operationId: "uploadFile",
            summary: "Upload a file to the Jules bot",
            description: "Uploads a file to the Jules Dispatch bot with optional caption and prompt",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      file: { type: "string", format: "binary" },
                      caption: { type: "string" },
                      prompt: { type: "string" }
                    },
                    required: ["file"]
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "File uploaded successfully",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean" },
                        fileId: { type: "string" },
                        filename: { type: "string" },
                        size: { type: "number" },
                        threadId: { type: "string" },
                        promptProcessed: { type: "boolean" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "CONVEX_DEPLOY_KEY"
          }
        }
      },
      security: [{ bearerAuth: [] }]
    };

    return new Response(JSON.stringify(spec), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  })
});

// Serve static files at /settings/* with SPA fallback to index.html
// MUST be after all API routes so they take precedence
registerStaticRoutes(http, components.selfHosting, {
  pathPrefix: "/settings",
  spaFallback: true,
});

// Serve same app at /dashboard/* with SPA fallback
registerStaticRoutes(http, components.selfHosting, {
  pathPrefix: "/dashboard",
  spaFallback: true,
});

export default http;

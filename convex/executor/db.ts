import { v } from "convex/values";
import { internalMutation, mutation, internalQuery, httpAction } from "../_generated/server";

// ---------------------------------------------------------------------------
// KV Store (Tools, Definitions, Policies) — all internal
// ---------------------------------------------------------------------------

export const getKv = internalQuery({
  args: {
    userId: v.string(),
    namespace: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns_key", (q) =>
        q.eq("userId", args.userId).eq("namespace", args.namespace).eq("key", args.key)
      )
      .unique();
    return entry?.value ?? null;
  },
});

export const setKv = internalMutation({
  args: {
    userId: v.string(),
    namespace: v.string(),
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns_key", (q) =>
        q.eq("userId", args.userId).eq("namespace", args.namespace).eq("key", args.key)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("executor_kv", {
        userId: args.userId,
        namespace: args.namespace,
        key: args.key,
        value: args.value,
      });
    }
  },
});

export const listKv = internalQuery({
  args: {
    userId: v.string(),
    namespace: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns", (q) =>
        q.eq("userId", args.userId).eq("namespace", args.namespace)
      )
      .collect();
  },
});

export const deleteKv = internalMutation({
  args: {
    userId: v.string(),
    namespace: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns_key", (q) =>
        q.eq("userId", args.userId).eq("namespace", args.namespace).eq("key", args.key)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Secrets (API Keys, Tokens) — all internal
// ---------------------------------------------------------------------------

export const getSecret = internalQuery({
  args: {
    userId: v.string(),
    secretId: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("executor_secrets")
      .withIndex("by_user_secretId", (q) =>
        q.eq("userId", args.userId).eq("secretId", args.secretId)
      )
      .unique();
    return entry?.value ?? null;
  },
});

export const setSecret = internalMutation({
  args: {
    userId: v.string(),
    secretId: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executor_secrets")
      .withIndex("by_user_secretId", (q) =>
        q.eq("userId", args.userId).eq("secretId", args.secretId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("executor_secrets", {
        userId: args.userId,
        secretId: args.secretId,
        value: args.value,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Sessions (Sandbox Pooling) — all internal
// ---------------------------------------------------------------------------

export const getSession = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("executor_sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

export const getSessionByToken = internalQuery({
  args: { ipcToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("executor_sessions")
      .withIndex("by_ipcToken", (q) => q.eq("ipcToken", args.ipcToken))
      .unique();
  },
});

export const upsertSession = internalMutation({
  args: {
    userId: v.string(),
    sandboxId: v.string(),
    image: v.string(),
    ipcToken: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executor_sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        sandboxId: args.sandboxId,
        image: args.image,
        ipcToken: args.ipcToken,
        lastUsedAt: now,
      });
    } else {
      await ctx.db.insert("executor_sessions", {
        userId: args.userId,
        sandboxId: args.sandboxId,
        image: args.image,
        ipcToken: args.ipcToken,
        lastUsedAt: now,
      });
    }
  },
});

export const deleteSession = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executor_sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ---------------------------------------------------------------------------
// Bulk Sync (HTTP endpoint — called from CLI)
// Auth: requires the CONVEX_DEPLOY_KEY env var to match the Authorization header.
// This reuses the same deploy key used for `npx convex deploy`.
// Using an HTTP action with header auth keeps the key out of mutation args/logs.
// ---------------------------------------------------------------------------

export const bulkSyncHttp = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deployKey = authHeader.slice("Bearer ".length);
  const expectedKey = process.env.CONVEX_DEPLOY_KEY;
  if (!expectedKey || deployKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Invalid deploy key" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { userId: string; entries: { namespace: string; key: string; value: string }[] };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.userId || !Array.isArray(body.entries)) {
    return new Response(JSON.stringify({ error: "Missing required fields: userId, entries" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  for (const entry of body.entries) {
    const existing = await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns_key", (q) =>
        q.eq("userId", body.userId).eq("namespace", entry.namespace).eq("key", entry.key)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: entry.value });
    } else {
      await ctx.db.insert("executor_kv", {
        userId: body.userId,
        namespace: entry.namespace,
        key: entry.key,
        value: entry.value,
      });
    }
  }

  return new Response(JSON.stringify({ synced: body.entries.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export const bulkSyncWithReplaceHttp = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deployKey = authHeader.slice("Bearer ".length);
  const expectedKey = process.env.CONVEX_DEPLOY_KEY;
  if (!expectedKey || deployKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Invalid deploy key" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    userId: string;
    entries: { namespace: string; key: string; value: string }[];
    namespaces: string[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.userId || !Array.isArray(body.entries) || !Array.isArray(body.namespaces)) {
    return new Response(JSON.stringify({ error: "Missing required fields: userId, entries, namespaces" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Delete all existing entries for each namespace being replaced
  for (const ns of body.namespaces) {
    const existing = await ctx.db
      .query("executor_kv")
      .withIndex("by_user_ns", (q) =>
        q.eq("userId", body.userId).eq("namespace", ns)
      )
      .collect();

    for (const entry of existing) {
      await ctx.db.delete(entry._id);
    }
  }

  // Insert all new entries
  for (const entry of body.entries) {
    await ctx.db.insert("executor_kv", {
      userId: body.userId,
      namespace: entry.namespace,
      key: entry.key,
      value: entry.value,
    });
  }

  return new Response(JSON.stringify({ synced: body.entries.length, namespaces: body.namespaces }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export const syncSecretsHttp = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deployKey = authHeader.slice("Bearer ".length);
  const expectedKey = process.env.CONVEX_DEPLOY_KEY;
  if (!expectedKey || deployKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Invalid deploy key" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    userId: string;
    secrets: { secretId: string; value: string }[];
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.userId || !Array.isArray(body.secrets)) {
    return new Response(JSON.stringify({ error: "Missing required fields: userId, secrets" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  for (const secret of body.secrets) {
    const existing = await ctx.db
      .query("executor_secrets")
      .withIndex("by_user_secretId", (q) =>
        q.eq("userId", body.userId).eq("secretId", secret.secretId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { value: secret.value });
    } else {
      await ctx.db.insert("executor_secrets", {
        userId: body.userId,
        secretId: secret.secretId,
        value: secret.value,
      });
    }
  }

  return new Response(JSON.stringify({ synced: body.secrets.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export const bulkSyncKvWithReplace = mutation({
  args: {
    userId: v.string(),
    entries: v.array(
      v.object({
        namespace: v.string(),
        key: v.string(),
        value: v.string(),
      })
    ),
    namespaces: v.array(v.string()),
    deployKey: v.string(),
  },
  handler: async (ctx, args) => {
    const expectedKey = process.env.CONVEX_DEPLOY_KEY;
    if (!expectedKey || args.deployKey !== expectedKey) {
      throw new Error("Invalid deploy key.");
    }

    for (const ns of args.namespaces) {
      const existing = await ctx.db
        .query("executor_kv")
        .withIndex("by_user_ns", (q) =>
          q.eq("userId", args.userId).eq("namespace", ns)
        )
        .collect();

      for (const entry of existing) {
        await ctx.db.delete(entry._id);
      }
    }

    for (const entry of args.entries) {
      await ctx.db.insert("executor_kv", {
        userId: args.userId,
        namespace: entry.namespace,
        key: entry.key,
        value: entry.value,
      });
    }
  },
});
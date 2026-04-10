import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import Database from "better-sqlite3";
import { readHomeConfig, parseDeployKey } from "../config.js";
import { c as colors } from "../ui.js";
import { cliLogger } from "../utils/logger.js";

const EXECUTOR_DB_PATHS = [
  path.join(os.homedir(), ".executor", "data.db"),
  path.join(os.homedir(), ".config", "executor", "data.db"),
  path.join(os.homedir(), "Library", "Application Support", "executor", "data.db"),
  path.join(process.env.APPDATA || "", "executor", "data.db"),
];

const AUTH_JSON_PATHS = [
  path.join(os.homedir(), ".local", "share", "executor", "auth.json"),
  path.join(os.homedir(), ".config", "executor", "auth.json"),
];

interface ScopeInfo {
  scopePath: string;
  scopeId: string;
  namespaces: string[];
  sourceCounts: { openapi: number; mcp: number; googleDiscovery: number };
  toolCount: number;
}

interface SecretRef {
  id: string;
  name: string;
  provider: string;
  purpose?: string;
  scopeId: string;
}

interface SecretValue {
  secretId: string;
  value: string;
  name: string;
}

function computeScopeId(cwd: string): string {
  const folder = path.basename(cwd) || cwd;
  const hash = crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 8);
  return `${folder}-${hash}`;
}

function detectScopes(db: Database.Database): ScopeInfo[] {
  const rows = db.prepare("SELECT DISTINCT namespace FROM kv").all() as { namespace: string }[];
  const scopeMap = new Map<string, Set<string>>();

  for (const row of rows) {
    const ns = row.namespace;
    const idx = ns.indexOf("::");
    if (idx === -1) continue;
    const scopePath = ns.substring(0, idx);
    const suffix = ns.substring(idx + 2);
    if (!scopeMap.has(scopePath)) scopeMap.set(scopePath, new Set());
    scopeMap.get(scopePath)!.add(suffix);
  }

  const scopes: ScopeInfo[] = [];
  for (const [scopePath, suffixes] of scopeMap) {
    const scopeId = computeScopeId(scopePath);
    const toolCount = (db.prepare("SELECT COUNT(*) as cnt FROM kv WHERE namespace = ?").get(`${scopePath}::tools`) as { cnt: number } | undefined)?.cnt ?? 0;
    const openapiCount = (db.prepare("SELECT COUNT(*) as cnt FROM kv WHERE namespace = ?").get(`${scopePath}::openapi.sources`) as { cnt: number } | undefined)?.cnt ?? 0;
    const mcpCount = (db.prepare("SELECT COUNT(*) as cnt FROM kv WHERE namespace = ?").get(`${scopePath}::mcp.sources`) as { cnt: number } | undefined)?.cnt ?? 0;
    const googleCount = (db.prepare("SELECT COUNT(*) as cnt FROM kv WHERE namespace = ?").get(`${scopePath}::google-discovery.sources`) as { cnt: number } | undefined)?.cnt ?? 0;
    scopes.push({ scopePath, scopeId, namespaces: [...suffixes], sourceCounts: { openapi: openapiCount, mcp: mcpCount, googleDiscovery: googleCount }, toolCount });
  }
  return scopes;
}

function readScopeEntries(db: Database.Database, scopePath: string): { namespace: string; key: string; value: string }[] {
  const prefix = `${scopePath}::`;
  const rows = db.prepare("SELECT namespace, key, value FROM kv WHERE namespace LIKE ?").all(`${prefix}%`) as { namespace: string; key: string; value: string }[];
  return rows.map(row => ({ namespace: row.namespace.substring(prefix.length), key: row.key, value: row.value }));
}

function readSecretRefs(db: Database.Database, scopePath: string): SecretRef[] {
  const rows = db.prepare("SELECT key, value FROM kv WHERE namespace = ?").all(`${scopePath}::secrets`) as { key: string; value: string }[];
  return rows.map(row => {
    try {
      const ref = JSON.parse(row.value);
      return { id: ref.id ?? row.key, name: ref.name ?? row.key, provider: ref.provider ?? "unknown", purpose: ref.purpose, scopeId: ref.scopeId ?? "" };
    } catch {
      return { id: row.key, name: row.key, provider: "unknown", scopeId: "" };
    }
  });
}

function readAuthJson(scopeId: string): Record<string, string> | null {
  for (const authPath of AUTH_JSON_PATHS) {
    if (!fs.existsSync(authPath)) continue;
    try {
      const content = fs.readFileSync(authPath, "utf-8");
      const auth = JSON.parse(content);
      return auth[scopeId] ?? null;
    } catch { continue; }
  }
  return null;
}

function collectNamespaces(entries: { namespace: string }[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) seen.add(e.namespace);
  return [...seen];
}

function getConvexSiteUrl(config: ReturnType<typeof readHomeConfig>): string {
  if (!config?.installPath) return "";
  const envLocalPath = path.join(config.installPath, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const env = fs.readFileSync(envLocalPath, "utf-8");
    const urlMatch = env.match(/CONVEX_SITE_URL=(.+)/);
    if (urlMatch) return urlMatch[1]!.trim();
  }
  if (config.deployKey) {
    const keyInfo = parseDeployKey(config.deployKey);
    if (keyInfo) return keyInfo.convexSiteUrl;
  }
  return "";
}

export async function runSyncCommand() {
  cliLogger.info("Sync command started");

  const config = readHomeConfig();
  if (!config) {
    p.log.error(colors.red("No jules-dispatch configuration found. Please run setup first."));
    return;
  }

  // Step 0: Find Executor DB
  let dbPath = "";
  for (const pPath of EXECUTOR_DB_PATHS) {
    if (fs.existsSync(pPath)) { dbPath = pPath; break; }
  }

  if (!dbPath) {
    const manualPath = await p.text({ message: "Could not find executor database. Enter the path:", placeholder: "~/.executor/data.db" });
    if (p.isCancel(manualPath)) return;
    dbPath = (manualPath as string).startsWith("~") ? path.join(os.homedir(), (manualPath as string).slice(1)) : manualPath as string;
    if (!fs.existsSync(dbPath)) {
      p.log.error(colors.red(`File not found: ${dbPath}`));
      return;
    }
  }

  // Step 1: Open DB & select scope
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err: any) {
    p.log.error(colors.red(`Failed to open database: ${err.message}`));
    return;
  }

  const scopes = detectScopes(db);
  if (scopes.length === 0) {
    p.log.error(colors.red("No executor scopes found in the database."));
    p.log.info(colors.dim("Make sure the Executor has been used to configure tools in this project directory."));
    db.close();
    return;
  }

  let selectedScope: ScopeInfo;
  if (scopes.length === 1) {
    selectedScope = scopes[0]!;
    p.log.info(`Auto-selected sole scope: ${selectedScope.scopePath}`);
  } else {
    const choice = await p.select({
      message: "Which Executor scope do you want to sync?",
      options: scopes.map(s => ({
        value: s as ScopeInfo,
        label: s.scopePath,
        hint: [s.sourceCounts.openapi > 0 ? `${s.sourceCounts.openapi} OpenAPI` : null, s.sourceCounts.mcp > 0 ? `${s.sourceCounts.mcp} MCP` : null, s.sourceCounts.googleDiscovery > 0 ? `${s.sourceCounts.googleDiscovery} Google` : null, `${s.toolCount} tools`].filter(Boolean).join(", ") || "no sources",
      })),
    });
    if (p.isCancel(choice)) { db.close(); return; }
    selectedScope = choice as ScopeInfo;
  }

  // Step 2: Read & display scope data
  p.log.info(colors.bold(`\nScope: ${selectedScope.scopePath}`));
  p.log.info(`  Scope ID: ${selectedScope.scopeId}`);
  p.log.info(`  Namespaces: ${selectedScope.namespaces.join(", ")}`);
  p.log.info(`  Tools: ${selectedScope.toolCount}`);

  const entries = readScopeEntries(db, selectedScope.scopePath);
  const namespaces = collectNamespaces(entries);
  const secretRefs = readSecretRefs(db, selectedScope.scopePath);

  // Step 3: Resolve secrets
  const secretValues: SecretValue[] = [];
  if (secretRefs.length > 0) {
    p.log.info(colors.bold("\nResolving secrets...\n"));
    const authJsonValues = readAuthJson(selectedScope.scopeId);

    for (const ref of secretRefs) {
      p.log.info(`  ${colors.cyan(ref.name)} (provider: ${ref.provider})`);

      if (ref.provider === "file") {
        const value = authJsonValues?.[ref.id];
        if (value) {
          p.log.info(`    ${colors.green("\u2713 Found in auth.json")}`);
          secretValues.push({ secretId: ref.id, value, name: ref.name });
          continue;
        }
        p.log.warn(`    ${colors.yellow("\u26A0 Not found in auth.json")}`);
      }

      if (ref.provider !== "file" || !authJsonValues?.[ref.id]) {
        const secretInput = await p.text({ message: `Enter value for "${ref.name}" (${ref.provider}):`, placeholder: "Leave empty to skip" });
        if (p.isCancel(secretInput)) { db.close(); return; }
        const trimmed = (secretInput as string).trim();
        if (trimmed) {
          secretValues.push({ secretId: ref.id, value: trimmed, name: ref.name });
          p.log.info(`    ${colors.green("\u2713 Saved")}`);
        } else {
          p.log.warn(`    ${colors.yellow("\u26A0 Skipped \u2014 tool calls requiring this secret will fail")}`);
        }
      }
    }
  }

  // Step 4: Summary & confirm
  p.log.info(colors.bold("\nSync Summary"));
  p.log.info(`  Scope: ${selectedScope.scopePath}`);
  p.log.info(`  Namespaces: ${namespaces.join(", ")}`);
  p.log.info(`  Total entries: ${entries.length}`);
  p.log.info(`  Secrets to sync: ${secretValues.length}`);

  const convexSiteUrl = getConvexSiteUrl(config);
  if (!convexSiteUrl) {
    p.log.error(colors.red("Could not determine Convex site URL. Run 'npx jules-dispatch deploy' first."));
    db.close();
    return;
  }

  const proceed = await p.confirm({ message: "Proceed with sync?", initialValue: true });
  if (p.isCancel(proceed) || !proceed) { p.log.info("Sync cancelled."); db.close(); return; }

  // Step 5: Sync to Convex
  const s = p.spinner();
  s.start("Syncing to Convex...");

  try {
    const deployKey = config.deployKey;
    if (!deployKey) throw new Error("No deploy key found. Run 'npx jules-dispatch deploy' first.");

    const userId = "global_user";
    const chunkSize = 100;
    let totalSynced = 0;
    let isFirstChunk = true;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      const body: Record<string, unknown> = {
        userId,
        entries: chunk,
        namespaces: isFirstChunk ? namespaces : [],
      };

      const response = await fetch(`${convexSiteUrl}/executor/sync/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deployKey}` },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`KV sync failed (${response.status}): ${errorBody}`);
      }

      const result = await response.json() as { synced: number };
      totalSynced += chunk.length;
      isFirstChunk = false;
    }

    s.stop(`Synced ${totalSynced} KV entries.`);

    // Sync secrets
    if (secretValues.length > 0) {
      s.start("Uploading secrets...");
      const secretsResponse = await fetch(`${convexSiteUrl}/executor/sync/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deployKey}` },
        body: JSON.stringify({ userId, secrets: secretValues.map(s => ({ secretId: s.secretId, value: s.value })) }),
      });

      if (!secretsResponse.ok) {
        const errorBody = await secretsResponse.text();
        throw new Error(`Secrets sync failed (${secretsResponse.status}): ${errorBody}`);
      }

      const secretsResult = await secretsResponse.json() as { synced: number };
      s.stop(`Synced ${secretsResult.synced} secrets.`);
    }

    p.log.success(colors.bold("Success!") + ` Synced ${entries.length} entries and ${secretValues.length} secrets.`);
  } catch (err: any) {
    cliLogger.error("Sync failed", err);
    s.stop("Sync failed");
    p.log.error(colors.red(`Error: ${err.message}`));
  } finally {
    db.close();
  }
}
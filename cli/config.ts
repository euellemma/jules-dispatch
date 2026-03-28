import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface JulesDispatchConfig {
  installPath: string;
  projectSlug: string;
  deployKey?: string;
  telegramBotToken?: string;
  julesApiKey?: string;
  exaApiKey?: string;
  customConfig?: {
    endpoint: string;
    model: string;
    apiKey: string;
    sdkType: "openai" | "anthropic" | "google" | "auto";
  };
  createdAt: string;
  updatedAt: string;
}

export interface DeployKeyInfo {
  team: string;
  project: string;
  deploymentName: string;
  convexUrl: string;
  convexSiteUrl: string;
}

const CONFIG_FILE = ".jules-dispatch.json";
const HOME_CONFIG_FILE = path.join(os.homedir(), CONFIG_FILE);

export function parseDeployKey(deployKey: string): DeployKeyInfo | null {
  // Format: team:qualified-jaguar-123|eyJ2ZXJzaW9u...
  const parts = deployKey.split("|");
  if (parts.length < 2) return null;

  const prefix = parts[0];
  if (!prefix) return null;

  const colonIdx = prefix.indexOf(":");
  if (colonIdx < 0) return null;

  const team = prefix.substring(0, colonIdx);
  const deploymentName = prefix.substring(colonIdx + 1);

  if (!team || !deploymentName) return null;

  return {
    team,
    project: deploymentName,
    deploymentName,
    convexUrl: `https://${deploymentName}.convex.cloud`,
    convexSiteUrl: `https://${deploymentName}.convex.site`,
  };
}

export function getHomeConfigPath(): string {
  return HOME_CONFIG_FILE;
}

export function readHomeConfig(): JulesDispatchConfig | null {
  try {
    if (fs.existsSync(HOME_CONFIG_FILE)) {
      const content = fs.readFileSync(HOME_CONFIG_FILE, "utf-8");
      return JSON.parse(content) as JulesDispatchConfig;
    }
  } catch (error) {
    console.error("[config] Error reading home config:", error);
  }
  return null;
}

export function writeHomeConfig(config: JulesDispatchConfig): void {
  try {
    fs.writeFileSync(HOME_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    fs.chmodSync(HOME_CONFIG_FILE, 0o600);
  } catch (error) {
    console.error("[config] Error writing home config:", error);
    throw error;
  }
}

export function findJulesDispatchProject(): string | null {
  const cwd = process.cwd();
  const homeConfig = readHomeConfig();

  if (isJulesDispatchDir(cwd)) {
    return cwd;
  }

  if (homeConfig && fs.existsSync(homeConfig.installPath)) {
    if (isJulesDispatchDir(homeConfig.installPath)) {
      return homeConfig.installPath;
    }
  }

  const defaultPath = path.join(os.homedir(), "jules-dispatch");
  if (fs.existsSync(defaultPath) && isJulesDispatchDir(defaultPath)) {
    return defaultPath;
  }

  return null;
}

function isJulesDispatchDir(dirPath: string): boolean {
  const hasConvex = fs.existsSync(path.join(dirPath, "convex"));
  const hasPackageJson = fs.existsSync(path.join(dirPath, "package.json"));
  return hasConvex && hasPackageJson;
}

export function readEnvLocal(installPath: string): Record<string, string> {
  const envPath = path.join(installPath, ".env.local");
  const envVars: Record<string, string> = {};

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex);
            const value = trimmed.substring(eqIndex + 1);
            envVars[key] = value;
          }
        }
      }
    }
  } catch (error) {
    console.error("[config] Error reading .env.local:", error);
  }

  return envVars;
}

export function writeEnvLocal(installPath: string, updates: Record<string, string>): void {
  const envPath = path.join(installPath, ".env.local");
  const existing = readEnvLocal(installPath);
  const merged = { ...existing, ...updates };

  const lines: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}=${value}`);
  }

  try {
    fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
  } catch (error) {
    console.error("[config] Error writing .env.local:", error);
    throw error;
  }
}

export function removeEnvKeys(installPath: string, keys: string[]): void {
  const envPath = path.join(installPath, ".env.local");
  const existing = readEnvLocal(installPath);
  for (const key of keys) {
    delete existing[key];
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(existing)) {
    lines.push(`${key}=${value}`);
  }

  try {
    fs.writeFileSync(envPath, lines.join("\n") + "\n", "utf-8");
  } catch (error) {
    console.error("[config] Error writing .env.local:", error);
    throw error;
  }
}

export function createDefaultConfig(installPath: string): JulesDispatchConfig {
  const now = new Date().toISOString();
  return {
    installPath,
    projectSlug: "jules-dispatch",
    createdAt: now,
    updatedAt: now,
  };
}

export function updateConfig(config: JulesDispatchConfig, updates: Partial<JulesDispatchConfig>): JulesDispatchConfig {
  return {
    ...config,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

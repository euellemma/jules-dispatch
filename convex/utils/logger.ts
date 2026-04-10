/**
 * Unified Logger for Jules Dispatch
 * Supports structured console logging and optional Axiom cloud logging.
 */

// HARDCODED API KEY (as requested)
// Set this to your Axiom API Token to enable cloud logging.
const AXIOM_API_KEY = "xaat-0738ef76-eaee-47fe-885e-cc76be95ebbc";
const AXIOM_DATASET = "jules-dispatch";
const AXIOM_ORG_ID = "nebaorg-kskd"; // Optional, but recommended for some API tokens

type LogLevel = "info" | "warn" | "error" | "debug" | "context" | "tool";

interface LogEntry {
  _time?: string;
  level: LogLevel;
  service: "convex" | "cli" | "web";
  msg: string;
  threadId?: string;
  userId?: string;
  data?: any;
  error?: any;

  // Standardized AI Attributes (for Axiom AI Intelligence)
  "ai.prompt"?: any;
  "ai.completion"?: any;
  "ai.model"?: string;
  "ai.usage.total_tokens"?: number;
  "ai.usage.prompt_tokens"?: number;
  "ai.usage.completion_tokens"?: number;
}

class Logger {
  private service: "convex" | "cli" | "web";

  constructor(service: "convex" | "cli" | "web") {
    this.service = service;
  }

  private async sendToAxiom(entry: LogEntry) {
    if (!AXIOM_API_KEY) return;

    const url = `https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`;

    try {
      /*
      // We use a fire-and-forget fetch approach in Convex to avoid blocking
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AXIOM_API_KEY}`,
          "Content-Type": "application/json",
          ...(AXIOM_ORG_ID ? { "X-Axiom-Org-Id": AXIOM_ORG_ID } : {}),
        },
        body: JSON.stringify([entry]),
      }).catch((err) => {
        // Silent catch for Axiom ingestion errors to prevent recursion/noise
      });
      */
    } catch (err) {
      // Silent catch
    }
  }

  private formatConsole(entry: LogEntry) {
    const icon = {
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
      debug: "🔍",
      context: "🧠",
      tool: "🛠️",
    }[entry.level];

    const threadTag = entry.threadId ? `[${entry.threadId.slice(-6)}] ` : "";
    const baseMsg = `${icon} [${this.service.toUpperCase()}] ${threadTag}${entry.msg}`;

    if (entry.level === "error") {
      console.error(baseMsg, entry.error || "", entry.data || "");
    } else if (entry.level === "warn") {
      console.warn(baseMsg, entry.data || "");
    } else {
      console.log(baseMsg, entry.data || "");
    }
  }

  log(level: LogLevel, msg: string, meta: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      _time: new Date().toISOString(),
      level,
      service: this.service,
      msg,
      ...meta,
    };

    // 1. Structured Console Log
    this.formatConsole(entry);

    // 2. Axiom Cloud Log (Disabled - Configure Axiom via Convex Dashboard Log Streaming instead)
    // if (AXIOM_API_KEY) {
    //   this.sendToAxiom(entry);
    // }
  }

  info(msg: string, meta: Partial<LogEntry> = {}) {
    this.log("info", msg, meta);
  }
  warn(msg: string, meta: Partial<LogEntry> = {}) {
    this.log("warn", msg, meta);
  }
  error(msg: string, err?: any, meta: Partial<LogEntry> = {}) {
    this.log("error", msg, { ...meta, error: err });
  }
  debug(msg: string, meta: Partial<LogEntry> = {}) {
    this.log("debug", msg, meta);
  }
  context(msg: string, data: any, meta: Partial<LogEntry> = {}) {
    this.log("context", msg, { ...meta, data });
  }
  tool(msg: string, data: any, meta: Partial<LogEntry> = {}) {
    this.log("tool", msg, { ...meta, data });
  }
}

export const logger = new Logger("convex");
export const cliLogger = new Logger("cli");
export const webLogger = new Logger("web");

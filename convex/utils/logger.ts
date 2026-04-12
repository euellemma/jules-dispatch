/**
 * Unified Logger for Jules Dispatch
 * Supports structured console logging.
 */

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

  // Standardized AI Attributes
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

    // Structured Console Log
    this.formatConsole(entry);
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

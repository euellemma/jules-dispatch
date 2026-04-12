/**
 * Unified Logger for Jules Dispatch CLI
 * Supports structured console logging.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  _time?: string;
  level: LogLevel;
  service: "cli";
  msg: string;
  data?: any;
  error?: any;
}

class CliLogger {
  log(level: LogLevel, msg: string, meta: any = {}) {
    const entry: LogEntry = {
      _time: new Date().toISOString(),
      level,
      service: "cli",
      msg,
      ...meta,
    };

    // Console Log
    const icon = {
      info: "ℹ️",
      warn: "⚠️",
      error: "❌",
      debug: "🔍",
    }[entry.level];

    const baseMsg = `${icon} [CLI] ${entry.msg}`;
    if (entry.level === "error") {
      console.error(baseMsg, entry.error || "", entry.data || "");
    } else if (entry.level === "warn") {
      console.warn(baseMsg, entry.data || "");
    } else {
      console.log(baseMsg, entry.data || "");
    }
  }

  info(msg: string, data?: any) {
    this.log("info", msg, { data });
  }
  warn(msg: string, data?: any) {
    this.log("warn", msg, { data });
  }
  error(msg: string, err?: any) {
    this.log("error", msg, { error: err });
  }
}

export const cliLogger = new CliLogger();

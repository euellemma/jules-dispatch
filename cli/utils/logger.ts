/**
 * Unified Logger for Jules Dispatch CLI
 * Supports structured console logging and optional Axiom cloud logging.
 */

// HARDCODED API KEY (as requested)
const AXIOM_API_KEY = "xaat-0738ef76-eaee-47fe-885e-cc76be95ebbc";
const AXIOM_DATASET = "jules-dispatch";
const AXIOM_ORG_ID = "nebaorg-kskd";

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
  private async sendToAxiom(entry: LogEntry) {
    if (!AXIOM_API_KEY) return;

    const url = `https://api.axiom.co/v1/datasets/${AXIOM_DATASET}/ingest`;

    try {
      // In Node.js, we use fetch
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AXIOM_API_KEY}`,
          "Content-Type": "application/json",
          ...(AXIOM_ORG_ID ? { "X-Axiom-Org-Id": AXIOM_ORG_ID } : {}),
        },
        body: JSON.stringify([entry]),
      }).catch(() => {});
    } catch (err) {}
  }

  log(level: LogLevel, msg: string, meta: any = {}) {
    const entry: LogEntry = {
      _time: new Date().toISOString(),
      level,
      service: "cli",
      msg,
      ...meta,
    };

    // Axiom Cloud Log (if configured)
    if (AXIOM_API_KEY) {
      this.sendToAxiom(entry);
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

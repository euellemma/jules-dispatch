/**
 * Lightweight Sentry error reporter for Convex V8 environment.
 *
 * V8 in Convex doesn't support npm packages directly, so we use fetch to
 * POST events to Sentry's ingest endpoint. This is a subset of what the
 * official SDK does — enough for catching unhandled errors and exceptions.
 *
 * Usage:
 *   import { captureException } from "./sentry";
 *   captureException(error, { extra: { context: "telegram_webhook" } });
 *
 * Required env var (set via `npx convex env set SENTRY_DSN=<dsn>`):
 *   SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
 *
 * For GitHub Actions / CI: set via secrets and pass during deploy:
 *   npx convex env set SENTRY_DSN=${{ secrets.SENTRY_DSN }}
 */

interface SentryEvent {
  event_id: string;
  timestamp: string;
  platform: string;
  level: string;
  logger: string;
  environment: string;
  release?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  message?: string;
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: SentryFrame[] };
    }>;
  };
}

interface SentryFrame {
  filename: string;
  lineno: number;
  colno: number;
  function: string;
}

/** Simple UUID v4 generator for event IDs */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function serializeStackTrace(error: unknown): SentryFrame[] {
  if (error instanceof Error && error.stack) {
    const lines = error.stack.split("\n").slice(1); // skip "Error: ..."
    return lines.map((line) => {
      const match = line.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/);
      if (match) {
        return {
          function: match[1] ?? "(anonymous)",
          filename: match[2] ?? "",
          lineno: parseInt(match[3] ?? "0", 10) || 0,
          colno: parseInt(match[4] ?? "0", 10) || 0,
        };
      }
      // try without function name
      const locMatch = line.match(/at\s+(.*?):(\d+):(\d+)/);
      if (locMatch) {
        return {
          function: "(anonymous)",
          filename: locMatch[1] ?? "",
          lineno: parseInt(locMatch[2] ?? "0", 10) || 0,
          colno: parseInt(locMatch[3] ?? "0", 10) || 0,
        };
      }
      return { function: line.trim(), filename: "", lineno: 0, colno: 0 };
    });
  }
  return [];
}

async function sendToSentry(dsn: string, event: SentryEvent): Promise<void> {
  try {
    const dsnUrl = new URL(dsn.replace("https://", "https://"));
    const projectId = dsnUrl.pathname.replace("/", "");
    const host = dsnUrl.host ?? dsnUrl.hostname ?? "";
    const storeUrl = `https://${host}/api/${projectId}/store/?sentry_version=7&sentry_client=convex/1.0`;

    await fetch(storeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    // Swallow errors — never let error reporting break the app
  }
}

export function captureException(
  error: unknown,
  options?: {
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
    level?: "error" | "warning" | "info";
    environment?: string;
  }
): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Sentry not configured, silently skip

  const eventId = uuidv4();
  const timestamp = new Date().toISOString();

  let message = "Unknown error";
  let exceptionType = "Error";
  let stackFrames: SentryFrame[] = [];

  if (error instanceof Error) {
    message = error.message;
    exceptionType = error.name || "Error";
    stackFrames = serializeStackTrace(error);
  } else if (typeof error === "string") {
    message = error;
    exceptionType = "StringError";
  }

  const event: SentryEvent = {
    event_id: eventId,
    timestamp,
    platform: "node",
    level: options?.level ?? "error",
    logger: "convex",
    environment: options?.environment ?? process.env.NODE_ENV ?? "production",
    tags: options?.tags,
    extra: options?.extra,
    message,
    exception: {
      values: [
        {
          type: exceptionType,
          value: message,
          ...(stackFrames.length > 0
            ? { stacktrace: { frames: stackFrames } }
            : {}),
        },
      ],
    },
  };

  // Fire-and-forget — don't await, don't block
  sendToSentry(dsn, event);
}

export function captureMessage(
  message: string,
  options?: {
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
    level?: "error" | "warning" | "info";
    environment?: string;
  }
): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const event: SentryEvent = {
    event_id: uuidv4(),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: options?.level ?? "info",
    logger: "convex",
    environment: options?.environment ?? process.env.NODE_ENV ?? "production",
    tags: options?.tags,
    extra: options?.extra,
    message,
  };

  sendToSentry(dsn, event);
}

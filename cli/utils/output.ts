/**
 * Plain text and JSON output helpers for CLI commands.
 * Replaces @clack/prompts decorated output for non-interactive commands.
 */

export function info(msg: string): void {
  console.log(msg);
}

export function success(msg: string): void {
  console.log(msg);
}

export function error(msg: string): void {
  console.error(msg);
}

export function warn(msg: string): void {
  console.error(msg);
}

export function jsonOut(data: unknown): void {
  console.log(JSON.stringify(data));
}

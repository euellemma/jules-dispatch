/**
 * @fileoverview Shared utilities for Jules skill scripts.
 */

/**
 * Reads all input from stdin and parses it as JSON.
 * @returns {Promise<any>} The parsed JSON data.
 */
export async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const dataStr = Buffer.concat(chunks).toString('utf8').trim();
  if (!dataStr) {
    throw new Error("No input provided on stdin");
  }
  return JSON.parse(dataStr);
}

/**
 * Writes data to stdout as formatted JSON and exits 0.
 * @param {any} data The data to stringify and output.
 */
export function writeStdoutJsonAndExit(data) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

/**
 * Logs an error to stderr and exits 1.
 * @param {Error|string} error The error to log.
 */
export function handleErrorAndExit(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }, null, 2));
  process.exit(1);
}

/**
 * Determines if the current module is the main entry point being executed.
 * @param {string} url The import.meta.url of the calling module.
 * @returns {boolean} True if the script is being run directly.
 */
export function isMainModule(url) {
  return url === `file://${process.argv[1]}`;
}

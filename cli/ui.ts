import * as p from "@clack/prompts";
import c from "picocolors";

export function printBanner(): void {
  console.log();
  p.intro(`${c.bold(c.bgCyan(c.black("  Jules Dispatch Setup Wizard  ")))}`);
}

export function printStep(message: string): void {
  p.log.step(message);
}

export function link(url: string): string {
  return `\x1b]8;;${url}\x1b\\${c.cyan(url)}\x1b]8;;\x1b\\`;
}

export function success(message: string): void {
  p.log.success(message);
}

export function error(message: string): void {
  p.log.error(c.red(message));
}

export function warn(message: string): void {
  p.log.warn(c.yellow(message));
}

export function info(message: string): void {
  p.log.info(c.dim(message));
}

export { p, c };

export function printOutro(message: string): void {
  p.outro(message);
}
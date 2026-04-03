#!/usr/bin/env node
import { spawn } from "child_process";
import { mkdirSync, createWriteStream, existsSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const isProd = args.includes("--prod");

const logsDir = resolve(process.cwd(), "logs");
if (!existsSync(logsDir)) {
  mkdirSync(logsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logFile = resolve(logsDir, `${isProd ? "prod" : "dev"}-${timestamp}.log`);

const logStream = createWriteStream(logFile, { flags: "a" });

console.log(`\n📝 Logging to: ${logFile}\n`);

const command = isProd ? "npx convex logs --prod" : "npx convex dev";
const child = spawn(command, [], {
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});

const writeLine = (data) => {
  process.stdout.write(data);
  logStream.write(data);
};

child.stdout.on("data", (data) => writeLine(data));
child.stderr.on("data", (data) => writeLine(data));

child.on("close", (code) => {
  logStream.end();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  logStream.end();
  process.exit(0);
});
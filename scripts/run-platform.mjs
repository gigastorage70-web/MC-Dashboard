import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function loadRootEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadRootEnv();

const mode = process.argv[2] === "start" ? "start" : "dev";
const isWin = process.platform === "win32";

const nextBin = path.resolve(
  process.cwd(),
  "node_modules",
  ".bin",
  isWin ? "next.cmd" : "next"
);
const tsxBin = path.resolve(
  process.cwd(),
  "worker",
  "node_modules",
  ".bin",
  isWin ? "tsx.cmd" : "tsx"
);

const nextArgs = mode === "start" ? ["start"] : ["dev"];
const workerCmd =
  mode === "start"
    ? process.execPath
    : tsxBin;
const workerArgs =
  mode === "start"
    ? ["worker/dist/worker/src/index.js"]
    : ["watch", "worker/src/index.ts"];

const children = [
  spawn(workerCmd, workerArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: isWin && mode !== "start",
  }),
  spawn(nextBin, nextArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    shell: isWin,
  }),
];

function shutdown(signal) {
  for (const c of children) {
    if (!c.killed) c.kill(signal);
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const c of children) {
  c.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
    }
  });
}

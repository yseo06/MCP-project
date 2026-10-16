import path from "node:path";
import fs from "node:fs";

export type Role = "reader" | "worker" | "admin";

export interface Config {
  port: number;
  workspaceRoot: string;
  tokens: Map<string, Role>;
  logFile: string;
  maxFileBytes: number;
  maxOutputChars: number;
}

/** Tiny .env loader so we need no extra dependency. Real env vars win. */
function loadDotEnv(file = ".env") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function loadConfig(): Config {
  loadDotEnv();
  const tokens = new Map<string, Role>();
  for (const pair of (process.env.MCP_TOKENS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [role, token] = pair.split(":");
    if (!["reader", "worker", "admin"].includes(role) || !token) {
      throw new Error(`Bad MCP_TOKENS entry "${role}:***". Use role:token with role in reader|worker|admin.`);
    }
    if (token.length < 16) throw new Error(`Token for role "${role}" is shorter than 16 characters.`);
    tokens.set(token, role as Role);
  }
  const root = path.resolve(process.env.WORKSPACE_ROOT ?? "./workspace");
  fs.mkdirSync(root, { recursive: true });
  return {
    port: Number(process.env.PORT ?? 3000),
    workspaceRoot: fs.realpathSync(root),
    tokens,
    logFile: path.resolve(process.env.LOG_FILE ?? "./logs/calls.jsonl"),
    maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 1_000_000),
    maxOutputChars: Number(process.env.MAX_OUTPUT_CHARS ?? 20_000),
  };
}

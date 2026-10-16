import fs from "node:fs";
import path from "node:path";

export interface CallRecord {
  ts: string;
  role: string;
  tool: string;
  args: unknown;
  ok: boolean;
  ms: number;
  outChars: number;
  error?: string;
}

let file = "";
export function initLogger(f: string) {
  file = f;
  fs.mkdirSync(path.dirname(f), { recursive: true });
}

/** Shorten big string args (file contents) so the log stays readable. */
function summarize(args: unknown): unknown {
  if (!args || typeof args !== "object") return args;
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([k, v]) =>
      typeof v === "string" && v.length > 120 ? [k, `${v.slice(0, 120)}… (${v.length} chars)`] : [k, v],
    ),
  );
}

export function logCall(r: Omit<CallRecord, "ts" | "args"> & { args: unknown }) {
  const rec: CallRecord = { ts: new Date().toISOString(), ...r, args: summarize(r.args) };
  if (file) fs.appendFile(file, JSON.stringify(rec) + "\n", () => {});
}

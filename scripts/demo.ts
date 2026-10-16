/**
 * Multi-step, multi-session demo. Run against a live server:
 *   MCP_URL=http://localhost:3000/mcp WORKER_TOKEN=... ADMIN_TOKEN=... npm run demo
 * Writes docs/TRANSCRIPT.md. Task: build a tiny "todo-cli" across TWO separate agent sessions.
 * Session 1 (planner/worker) starts the job and stops with a checkpoint.
 * Session 2 (fresh agent, no memory) resumes ONLY from handoff_read, finishes, commits.
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const WORKER = process.env.WORKER_TOKEN!;
const ADMIN = process.env.ADMIN_TOKEN!;
const out: string[] = ["# Tool-call transcript\n", `Server: ${URL_}\nGenerated: ${new Date().toISOString()}\n`];
let calls = 0;

async function session(label: string, token: string) {
  const c = new Client({ name: label, version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(URL_), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  out.push(`\n## ${label}\n`);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await c.callTool({ name, arguments: args });
    const text: string = r.content?.[0]?.text ?? "";
    calls++;
    const shortArgs = JSON.stringify(args, (_k, v) => (typeof v === "string" && v.length > 90 ? v.slice(0, 90) + "…" : v));
    out.push(`### ${calls}. \`${name}\` ${shortArgs}\n- isError: ${!!r.isError}\n\`\`\`\n${text.slice(0, 700)}${text.length > 700 ? "\n…" : ""}\n\`\`\`\n`);
    console.log(`${r.isError ? "ERR" : "ok "} ${label} ${name}`);
    return { text, isError: !!r.isError };
  };
}

// ---------- SESSION 1 ----------
const s1 = await session("Session 1 - agent 'builder-1' (worker)", WORKER);
await s1("handoff_read");
await s1("log_plan", { agent: "builder-1", plan: "1. write PROJECT_STATE goal\n2. scaffold todo/todo.py with add/list\n3. checkpoint, stop (session ends)" });
const st = await s1("read_file", { path: "PROJECT_STATE.md" });
const v = st.text.match(/version=(\w+)/)![1];
await s1("str_replace", { path: "PROJECT_STATE.md", old_str: "## Goal\n(not set)", new_str: "## Goal\nBuild todo-cli: a Python CLI with add, list, done commands and a test file.", if_version: v });
await s1("write_file", { path: "todo/todo.py", content: `import json, sys\nFILE = "todos.json"\n\ndef load():\n    try:\n        return json.load(open(FILE))\n    except FileNotFoundError:\n        return []\n\ndef add(text):\n    items = load(); items.append({"text": text, "done": False})\n    json.dump(items, open(FILE, "w"))\n\ndef list_items():\n    return load()\n\n# TODO: done(index) command\n` });
await s1("record_decision", { agent: "builder-1", decision: "Store todos in JSON, one file", rationale: "Simplest thing that works; SQLite rejected as overkill for a demo." });
await s1("git_commit", { message: "Scaffold todo-cli with add and list" });
await s1("save_checkpoint", { agent: "builder-1", done: "todo/todo.py has add() and list_items()", next: "Implement done(index) where the TODO marker is, add todo/test_todo.py, update PROJECT_STATE, commit" });

// ---------- SESSION 2 (fresh client, zero memory) ----------
const s2 = await session("Session 2 - agent 'builder-2' (worker, fresh context)", WORKER);
await s2("handoff_read");                                   // resume from files only
await s2("search_code", { pattern: "TODO", glob: "*.py" }); // find the exact spot instead of reading everything
// Read only the 5 lines around the hit (chunked), and take the version from the same call.
const fv = (await s2("read_file", { path: "todo/todo.py", offset_line: 14, limit_lines: 5 })).text.match(/version=(\w+)/)![1];
await s2("str_replace", { path: "todo/todo.py", old_str: "# TODO: done(index) command", new_str: "def done(index):\n    items = load(); items[index][\"done\"] = True\n    json.dump(items, open(FILE, \"w\"))", if_version: fv });
// Deliberate error to show recovery: this edit reuses the now-stale version -> conflict -> re-read -> retry
await s2("write_file", { path: "todo/test_todo.py", content: "from todo import add, done, list_items\n# tests here\n" });
const bad = await s2("str_replace", { path: "todo/todo.py", old_str: "def done(index):", new_str: "def done(index):  # marks complete", if_version: fv });
if (bad.isError) {
  const fresh = (await s2("read_file", { path: "todo/todo.py", limit_lines: 1 })).text.match(/version=(\w+)/)![1];
  await s2("str_replace", { path: "todo/todo.py", old_str: "def done(index):", new_str: "def done(index):  # marks complete", if_version: fresh });
}
const ps = (await s2("read_file", { path: "PROJECT_STATE.md" })).text.match(/version=(\w+)/)![1];
await s2("str_replace", { path: "PROJECT_STATE.md", old_str: "Not started.", new_str: "COMPLETE. add, list, done implemented; test stub present.", if_version: ps });
await s2("git_commit", { message: "Implement done() and add test stub" });
await s2("save_checkpoint", { agent: "builder-2", done: "done() implemented, committed", next: "None. Task complete." });
await s2("git_log", { limit: 5 });

// ---------- Security spot-check as a read-only agent and as admin ----------
const rd = await session("Session 3 - security spot checks", WORKER);
await rd("read_file", { path: "../../etc/passwd" });
await rd("write_file", { path: "/tmp/evil.txt", content: "x" });
await rd("read_file", { path: ".git/config" });
const adm = await session("Session 3b - admin destructive action", ADMIN);
await adm("delete_file", { path: "todo/test_todo.py", confirm: true });

out.push(`\n---\nTotal tool calls: ${calls}\n`);
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/TRANSCRIPT.md", out.join("\n"));
console.log(`\nWrote docs/TRANSCRIPT.md (${calls} calls)`);
process.exit(0);

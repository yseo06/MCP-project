import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3917;
const T = { admin: "admin-token-0123456789", worker: "worker-token-0123456789", reader: "reader-token-0123456789" };
let proc: ChildProcess; let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcphttp-"));
  proc = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), WORKSPACE_ROOT: path.join(dir, "ws"), LOG_FILE: path.join(dir, "calls.jsonl"),
      MCP_TOKENS: `admin:${T.admin},worker:${T.worker},reader:${T.reader}` },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
});
after(() => { proc.kill(); });

const rpc = (headers: Record<string, string>, url = `http://localhost:${PORT}/mcp`) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });

test("endpoint rejects missing / wrong token with 401", async () => {
  assert.equal((await rpc({})).status, 401);
  assert.equal((await rpc({ authorization: "Bearer wrong-token-000000000" })).status, 401);
  assert.equal((await rpc({}, `http://localhost:${PORT}/t/nope-nope-nope-nope/mcp`)).status, 401);
});

test("real MCP client connects with bearer token and with secret path", async () => {
  const a = new Client({ name: "t", version: "0" });
  await a.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), { requestInit: { headers: { authorization: `Bearer ${T.worker}` } } }));
  const tools = (await a.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("write_file") && !tools.includes("delete_file"));
  const b = new Client({ name: "t", version: "0" });
  await b.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/t/${T.reader}/mcp`)));
  assert.ok(!(await b.listTools()).tools.some((t) => t.name === "write_file"));
});

test("call log records calls with role", async () => {
  const c = new Client({ name: "t", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${PORT}/mcp`), { requestInit: { headers: { authorization: `Bearer ${T.admin}` } } }));
  await c.callTool({ name: "list_files", arguments: {} });
  await new Promise((r) => setTimeout(r, 200));
  const log = fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8");
  assert.match(log, /"tool":"list_files"/); assert.match(log, /"role":"admin"/);
});

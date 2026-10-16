import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpConfig, connect } from "./helpers.js";

test("tool count and role gating in tools/list", async () => {
  const cfg = tmpConfig();
  const names = async (role: any) => (await (await connect(cfg, role)).client.listTools()).tools.map((t) => t.name);
  const admin = await names("admin"), worker = await names("worker"), reader = await names("reader");
  assert.ok(admin.length >= 8, "need 8+ tools");
  assert.ok(admin.includes("delete_file"));
  assert.ok(!worker.includes("delete_file") && worker.includes("write_file"));
  assert.ok(!reader.includes("write_file") && !reader.includes("git_commit") && reader.includes("read_file"));
});

test("every tool has a description and an object schema", async () => {
  const { client } = await connect(tmpConfig(), "admin");
  for (const t of (await client.listTools()).tools) {
    assert.ok((t.description ?? "").length > 40, `${t.name} description too short`);
    assert.equal(t.inputSchema.type, "object");
  }
});

test("write / read / str_replace / version locking", async () => {
  const cfg = tmpConfig();
  const { call } = await connect(cfg, "worker");
  let r = await call("write_file", { path: "demo/a.txt", content: "hello\nworld\nhello\n" });
  assert.equal(r.isError, false);
  const v1 = r.text.match(/version=(\w+)/)![1];

  r = await call("str_replace", { path: "demo/a.txt", old_str: "hello", new_str: "x" });
  assert.equal(r.isError, true); assert.match(r.text, /matches 2 places/);
  r = await call("str_replace", { path: "demo/a.txt", old_str: "nope", new_str: "x" });
  assert.equal(r.isError, true); assert.match(r.text, /not found/);

  r = await call("str_replace", { path: "demo/a.txt", old_str: "world", new_str: "there", if_version: v1 });
  assert.equal(r.isError, false);
  // stale version now conflicts
  r = await call("write_file", { path: "demo/a.txt", content: "clobber", if_version: v1 });
  assert.equal(r.isError, true); assert.match(r.text, /Version conflict/);
  assert.equal(fs.readFileSync(path.join(cfg.workspaceRoot, "demo/a.txt"), "utf8"), "hello\nthere\nhello\n");

  r = await call("read_file", { path: "demo/a.txt", offset_line: 2, limit_lines: 1 });
  assert.match(r.text, /2\| there/); assert.match(r.text, /more lines/);
});

test("delete is admin-only, needs confirm, goes to trash, protects handoff files", async () => {
  const cfg = tmpConfig();
  const admin = await connect(cfg, "admin");
  await admin.call("write_file", { path: "tmp.txt", content: "x" });
  let r = await admin.call("delete_file", { path: "tmp.txt", confirm: false });
  assert.equal(r.isError, true); // zod rejects confirm != true
  assert.ok(fs.existsSync(path.join(cfg.workspaceRoot, "tmp.txt")));
  r = await admin.call("delete_file", { path: "tmp.txt", confirm: true });
  assert.equal(r.isError, false);
  assert.ok(!fs.existsSync(path.join(cfg.workspaceRoot, "tmp.txt")));
  assert.ok(fs.readdirSync(path.join(cfg.workspaceRoot, ".trash")).length === 1);
  r = await admin.call("delete_file", { path: "PROJECT_STATE.md", confirm: true });
  assert.equal(r.isError, true); assert.match(r.text, /handoff/);
  // a worker cannot even call it
  const worker = await connect(cfg, "worker");
  r = await worker.call("delete_file", { path: "x", confirm: true });
  assert.equal(r.isError, true);
});

test("search_code, repo_map, list_files", async () => {
  const cfg = tmpConfig();
  const { call } = await connect(cfg, "worker");
  await call("write_file", { path: "src/app.ts", content: "export function add(a:number,b:number){return a+b}\nexport class Foo {}\n// TODO fix\n" });
  let r = await call("search_code", { pattern: "todo", glob: "*.ts" });
  assert.match(r.text, /src\/app\.ts:3:/);
  r = await call("search_code", { pattern: "zzz-none" });
  assert.match(r.text, /No matches/);
  r = await call("search_code", { pattern: "(", regex: true });
  assert.equal(r.isError, true);
  r = await call("repo_map", {});
  assert.match(r.text, /function add/); assert.match(r.text, /class Foo/);
  r = await call("list_files", { path: ".", depth: 2 });
  assert.match(r.text, /src\//); assert.doesNotMatch(r.text, /\.git/);
});

test("git-lite: status, commit, log, diff", async () => {
  const cfg = tmpConfig();
  const { call } = await connect(cfg, "worker");
  await call("write_file", { path: "a.txt", content: "one\n" });
  assert.match((await call("git_status")).text, /a\.txt/);
  let r = await call("git_commit", { message: "add a.txt" });
  assert.equal(r.isError, false);
  assert.match((await call("git_log")).text, /add a\.txt/);
  assert.match((await call("git_log")).text, /mcp-worker/);
  await call("write_file", { path: "a.txt", content: "two\n" });
  assert.match((await call("git_diff", { path: "a.txt" })).text, /\+two/);
  await call("git_commit", { message: "update a.txt", paths: ["a.txt"] });
  r = await call("git_commit", { message: "nothing here" });
  assert.equal(r.isError, true); assert.match(r.text, /Nothing to commit/);
});

test("handoff tools append and handoff_read returns all four files in one call", async () => {
  const cfg = tmpConfig();
  const { call } = await connect(cfg, "worker");
  await call("log_plan", { agent: "a1", plan: "1. read\n2. write" });
  await call("record_decision", { agent: "a1", decision: "use zod", rationale: "strict schemas" });
  await call("save_checkpoint", { agent: "a1", done: "scaffold", next: "tests" });
  const r = await call("handoff_read");
  for (const f of ["PROJECT_STATE.md", "PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"]) assert.match(r.text, new RegExp(f));
  assert.match(r.text, /NEXT: tests/); assert.match(r.text, /use zod/); assert.match(r.text, /1\. read/);
});

test("output cap truncates huge results", async () => {
  const cfg = tmpConfig(); cfg.maxOutputChars = 300;
  const { call } = await connect(cfg, "worker");
  await call("write_file", { path: "big.txt", content: "line\n".repeat(500) });
  const r = await call("read_file", { path: "big.txt", limit_lines: 500 });
  assert.match(r.text, /truncated/);
});

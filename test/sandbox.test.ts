import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolveSafe, ToolError } from "../src/sandbox.js";
import { tmpConfig, connect } from "./helpers.js";

const cfg = tmpConfig();
const root = cfg.workspaceRoot;

test("allows normal relative paths", () => {
  assert.equal(resolveSafe(root, "demo/a.txt"), path.join(root, "demo/a.txt"));
  assert.equal(resolveSafe(root, "./a/../b.txt"), path.join(root, "b.txt"));
});

const attacks = [
  "../secret.txt", "../../etc/passwd", "a/../../x", "..", "/etc/passwd", "C:\\Windows\\system32",
  "..\\..\\x", "a/..\\..\\x", "ok\0.txt", "%2e%2e/x".replace("%2e%2e", ".."), ".git/config", "a/.git/HEAD", ".trash/x", "", 
];
for (const a of attacks) {
  test(`rejects path attack: ${JSON.stringify(a)}`, () => {
    assert.throws(() => resolveSafe(root, a), ToolError);
  });
}

test("rejects symlink that points outside the sandbox", () => {
  const outside = fs.mkdtempSync(path.join(path.dirname(root), "outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
  fs.symlinkSync(outside, path.join(root, "link"));
  assert.throws(() => resolveSafe(root, "link/secret.txt"), ToolError);
  assert.throws(() => resolveSafe(root, "link/new-file.txt"), ToolError);
});

test("tools return isError (not a crash) on traversal attempts", async () => {
  const { call } = await connect(cfg, "admin");
  for (const tool of ["read_file", "write_file", "str_replace", "delete_file", "list_files", "search_code", "repo_map", "git_diff"]) {
    const args: any = { path: "../../etc/passwd", content: "x", old_str: "a", new_str: "b", confirm: true, pattern: "root" };
    const r = await call(tool, args);
    assert.equal(r.isError, true, `${tool} should reject`);
    assert.match(r.text, /escapes|protected|Absolute/i);
  }
});

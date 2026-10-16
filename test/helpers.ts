import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config, Role } from "../src/config.js";
import { createServer } from "../src/server.js";
import { ensureGitRepo } from "../src/tools/git.js";
import { ensureHandoffFiles } from "../src/tools/handoff.js";

export function tmpConfig(): Config {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcpws-")));
  ensureHandoffFiles(root);
  ensureGitRepo(root);
  return { port: 0, workspaceRoot: root, tokens: new Map(), logFile: "", maxFileBytes: 1_000_000, maxOutputChars: 20_000 };
}

export async function connect(config: Config, role: Role) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await createServer(config, role).connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await client.callTool({ name, arguments: args });
    return { isError: !!r.isError, text: r.content?.[0]?.text as string };
  };
  return { client, call };
}

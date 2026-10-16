import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { resolveSafe, relPath, ToolError } from "../sandbox.js";

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, "-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 5_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: any) {
    // Never leak raw stack traces: surface only git's own message.
    const msg = (e.stderr?.toString() || e.message || "git failed").trim().split("\n")[0];
    throw new ToolError(`git error: ${msg}`);
  }
}

/** Make the workspace a git repo on first boot. */
export function ensureGitRepo(root: string) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    git(root, ["init", "-q"]);
    fs.mkdirSync(path.join(root, ".git", "info"), { recursive: true });
    fs.appendFileSync(path.join(root, ".git", "info", "exclude"), ".trash/\n");
  }
}

export const gitTools: ToolDef[] = [
  {
    name: "git_status",
    access: "read",
    description: "Show changed, staged and untracked files in the workspace (short format). Use before git_commit to see what will be saved.",
    inputSchema: {},
    handler(_a, { config }) {
      const out = git(config.workspaceRoot, ["status", "--short", "--branch"]);
      return out.trim() || "Clean: nothing to commit.";
    },
  },
  {
    name: "git_diff",
    access: "read",
    description: "Show the unified diff of uncommitted changes, optionally for one file. Output is truncated if long. Use to review your own edits before committing.",
    inputSchema: {
      path: z.string().optional().describe("Limit the diff to this file"),
    },
    handler({ path: p }, { config }) {
      const args = ["diff", "HEAD", "--no-color"];
      if (p) args.push("--", relPath(config.workspaceRoot, resolveSafe(config.workspaceRoot, p)));
      const hasHead = (() => { try { git(config.workspaceRoot, ["rev-parse", "HEAD"]); return true; } catch { return false; } })();
      if (!hasHead) return "No commits yet. Use git_status to see untracked files.";
      return git(config.workspaceRoot, args).trim() || "No uncommitted changes.";
    },
  },
  {
    name: "git_log",
    access: "read",
    description: "Show recent commits (hash, author, date, subject). Use to see what earlier sessions or agents saved.",
    inputSchema: {
      limit: z.number().int().min(1).max(50).default(10),
    },
    handler({ limit }, { config }) {
      try {
        return git(config.workspaceRoot, ["log", `-${limit}`, "--pretty=format:%h  %an  %ad  %s", "--date=iso-strict"]).trim() || "No commits yet.";
      } catch {
        return "No commits yet.";
      }
    },
  },
  {
    name: "git_commit",
    access: "write",
    description:
      "Stage files and create a commit. Pass paths to commit specific files, or omit to commit everything changed. Message must be 3-200 chars and describe the change. Fails if there is nothing to commit.",
    inputSchema: {
      message: z.string().min(3).max(200).describe("Commit message, imperative mood"),
      paths: z.array(z.string()).max(50).optional().describe("Files to stage; omit to stage all changes"),
    },
    handler({ message, paths }, { config, role }) {
      const root = config.workspaceRoot;
      if (paths?.length) {
        const rels = paths.map((p: string) => relPath(root, resolveSafe(root, p)));
        git(root, ["add", "--", ...rels]);
      } else {
        git(root, ["add", "-A"]);
      }
      if (!git(root, ["status", "--porcelain"]).trim()) throw new ToolError("Nothing to commit.");
      git(root, ["-c", `user.name=mcp-${role}`, "-c", "user.email=agent@mcp.local", "commit", "-q", "-m", message.replace(/\0/g, "")]);
      return `Committed: ${git(root, ["log", "-1", "--pretty=format:%h %s"])}`;
    },
  },
];

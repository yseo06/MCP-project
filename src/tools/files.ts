import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { resolveSafe, relPath, versionOf, ToolError, isProtectedName } from "../sandbox.js";

function readText(abs: string, rel: string, maxBytes: number): string {
  if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${rel}. Use list_files to see what exists.`);
  const st = fs.statSync(abs);
  if (st.isDirectory()) throw new ToolError(`${rel} is a directory. Use list_files instead.`);
  if (st.size > maxBytes * 5) throw new ToolError(`${rel} is ${st.size} bytes, too large. Use search_code to find the part you need.`);
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) throw new ToolError(`${rel} looks binary and cannot be read as text.`);
  return buf.toString("utf8");
}

function checkVersion(current: string | null, expected: string | undefined, rel: string) {
  if (expected === undefined) return;
  if (current === null) throw new ToolError(`if_version given but ${rel} does not exist.`);
  if (current !== expected) {
    throw new ToolError(`Version conflict on ${rel}: expected ${expected} but file is now ${current}. Another agent changed it. Re-read it with read_file, merge, and retry.`);
  }
}

export const fileTools: ToolDef[] = [
  {
    name: "list_files",
    access: "read",
    description:
      "List files and folders under a workspace directory. Use first to orient yourself. Shows type and size. Results are capped; use a deeper path instead of a bigger depth for large trees. Fails if the path does not exist.",
    inputSchema: {
      path: z.string().default(".").describe("Directory relative to workspace root, e.g. 'demo' or '.'"),
      depth: z.number().int().min(1).max(4).default(1).describe("How many levels to descend (1-4)"),
      max_entries: z.number().int().min(1).max(500).default(200),
    },
    handler({ path: p, depth, max_entries }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      if (!fs.existsSync(abs)) throw new ToolError(`Directory not found: ${p}`);
      if (!fs.statSync(abs).isDirectory()) throw new ToolError(`${p} is a file, not a directory. Use read_file.`);
      const lines: string[] = [];
      const walk = (dir: string, level: number) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          if (lines.length >= max_entries) return;
          if (isProtectedName(e.name)) continue;
          const full = path.join(dir, e.name);
          const indent = "  ".repeat(level - 1);
          if (e.isDirectory()) {
            lines.push(`${indent}${e.name}/`);
            if (level < depth) walk(full, level + 1);
          } else {
            lines.push(`${indent}${e.name}  (${fs.statSync(full).size} B)`);
          }
        }
      };
      walk(abs, 1);
      if (lines.length === 0) return `${relPath(config.workspaceRoot, abs)}/ is empty.`;
      const note = lines.length >= max_entries ? `\n… capped at ${max_entries} entries` : "";
      return lines.join("\n") + note;
    },
  },
  {
    name: "read_file",
    access: "read",
    description:
      "Read a text file in numbered lines, in chunks. Returns the file's `version` hash; pass it as if_version to write_file or str_replace to avoid overwriting another agent's work. Default is the first 200 lines; use offset_line to page. Prefer search_code for big files.",
    inputSchema: {
      path: z.string().describe("File path relative to workspace root"),
      offset_line: z.number().int().min(1).default(1).describe("1-based first line to return"),
      limit_lines: z.number().int().min(1).max(1000).default(200),
    },
    handler({ path: p, offset_line, limit_lines }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      const rel = relPath(config.workspaceRoot, abs);
      const text = readText(abs, rel, config.maxFileBytes);
      const lines = text.split("\n");
      const slice = lines.slice(offset_line - 1, offset_line - 1 + limit_lines);
      const end = offset_line - 1 + slice.length;
      const body = slice.map((l, i) => `${String(offset_line + i).padStart(5)}| ${l}`).join("\n");
      const more = end < lines.length ? `\n… ${lines.length - end} more lines. Call again with offset_line=${end + 1}.` : "";
      return `# ${rel}  version=${versionOf(text)}  lines=${lines.length}\n${body}${more}`;
    },
  },
  {
    name: "write_file",
    access: "write",
    description:
      "Create or fully overwrite a text file (parent folders are created). To change part of an existing file use str_replace instead. For an existing file, pass if_version from read_file so the write fails if someone else changed it. Returns the new version hash.",
    inputSchema: {
      path: z.string().describe("File path relative to workspace root"),
      content: z.string().describe("Full new file content"),
      if_version: z.string().optional().describe("Version hash from read_file; write fails on mismatch"),
    },
    handler({ path: p, content, if_version }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      const rel = relPath(config.workspaceRoot, abs);
      if (Buffer.byteLength(content) > config.maxFileBytes) throw new ToolError(`Content exceeds the ${config.maxFileBytes} byte limit.`);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw new ToolError(`${rel} is a directory.`);
      const current = fs.existsSync(abs) ? versionOf(fs.readFileSync(abs)) : null;
      checkVersion(current, if_version, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      return `${current ? "Overwrote" : "Created"} ${rel} (${Buffer.byteLength(content)} B). version=${versionOf(content)}`;
    },
  },
  {
    name: "str_replace",
    access: "write",
    description:
      "Replace one exact occurrence of old_str with new_str in a file. old_str must appear exactly once or the call fails, so widen it with surrounding text. Read the file first; never edit blind. Returns the new version hash.",
    inputSchema: {
      path: z.string(),
      old_str: z.string().min(1).describe("Exact text to find (must be unique in the file)"),
      new_str: z.string().describe("Replacement text (may be empty to delete)"),
      if_version: z.string().optional().describe("Version hash from read_file"),
    },
    handler({ path: p, old_str, new_str, if_version }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      const rel = relPath(config.workspaceRoot, abs);
      const text = readText(abs, rel, config.maxFileBytes);
      checkVersion(versionOf(text), if_version, rel);
      const count = text.split(old_str).length - 1;
      if (count === 0) throw new ToolError(`old_str not found in ${rel}. Re-read the file; whitespace must match exactly.`);
      if (count > 1) throw new ToolError(`old_str matches ${count} places in ${rel}. Include more surrounding text so it is unique.`);
      const next = text.replace(old_str, () => new_str);
      fs.writeFileSync(abs, next);
      return `Replaced 1 occurrence in ${rel}. version=${versionOf(next)}`;
    },
  },
  {
    name: "delete_file",
    access: "admin",
    description:
      "Delete a file by moving it to workspace/.trash (recoverable). Destructive, so it requires confirm=true and is available only to admin tokens. Cannot delete directories or protected files.",
    inputSchema: {
      path: z.string(),
      confirm: z.literal(true).describe("Must be exactly true to proceed"),
    },
    handler({ path: p }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      const rel = relPath(config.workspaceRoot, abs);
      if (!fs.existsSync(abs)) throw new ToolError(`File not found: ${rel}`);
      if (fs.statSync(abs).isDirectory()) throw new ToolError(`${rel} is a directory; delete_file only removes single files.`);
      if (["PROJECT_STATE.md", "PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"].includes(rel)) {
        throw new ToolError(`${rel} is a handoff file and cannot be deleted.`);
      }
      const trash = path.join(config.workspaceRoot, ".trash", `${Date.now()}-${rel.replace(/\//g, "__")}`);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(abs, trash);
      return `Moved ${rel} to ${relPath(config.workspaceRoot, trash)}`;
    },
  },
];

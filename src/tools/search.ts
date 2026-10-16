import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { resolveSafe, relPath, ToolError, isProtectedName } from "../sandbox.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".venv", "__pycache__"]);

function* walkFiles(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isProtectedName(e.name) || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

function globToRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*").replace(/\?/g, ".");
  return new RegExp(`(^|/)${esc}$`);
}

const SYMBOL_RE =
  /^\s*(export\s+)?(async\s+)?(function\*?|class|interface|type|const|def)\s+([A-Za-z_$][\w$]*)/;

export const searchTools: ToolDef[] = [
  {
    name: "search_code",
    access: "read",
    description:
      "Search text files under a folder for a string or regex and return matching lines as path:line: text. Use this instead of reading whole files. Optional glob filter like '*.ts'. Results are capped at max_results.",
    inputSchema: {
      pattern: z.string().min(1).describe("Text or regex to find"),
      path: z.string().default(".").describe("Folder to search, relative to workspace root"),
      glob: z.string().optional().describe("Filename filter, e.g. '*.ts' or 'src/**/*.py'"),
      regex: z.boolean().default(false).describe("Treat pattern as a regular expression"),
      case_sensitive: z.boolean().default(false),
      max_results: z.number().int().min(1).max(200).default(50),
    },
    handler({ pattern, path: p, glob, regex, case_sensitive, max_results }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      if (!fs.existsSync(abs)) throw new ToolError(`Path not found: ${p}`);
      let re: RegExp;
      try {
        re = new RegExp(regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), case_sensitive ? "" : "i");
      } catch (e) {
        throw new ToolError(`Invalid regex: ${(e as Error).message}`);
      }
      const gre = glob ? globToRegex(glob) : null;
      const files = fs.statSync(abs).isDirectory() ? walkFiles(abs) : [abs];
      const hits: string[] = [];
      let scanned = 0;
      for (const f of files) {
        const rel = relPath(config.workspaceRoot, f);
        if (gre && !gre.test(rel)) continue;
        const st = fs.statSync(f);
        if (st.size > config.maxFileBytes) continue;
        const buf = fs.readFileSync(f);
        if (buf.includes(0)) continue;
        scanned++;
        const lines = buf.toString("utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
            if (hits.length >= max_results) return hits.join("\n") + `\n… stopped at ${max_results} results; narrow the pattern or path.`;
          }
        }
      }
      return hits.length ? hits.join("\n") : `No matches in ${scanned} files.`;
    },
  },
  {
    name: "repo_map",
    access: "read",
    description:
      "Compact map of a folder: a tree plus the top-level functions, classes and types found in each source file (.ts .js .py). Use at the start of a coding task to see the shape of the project without reading every file.",
    inputSchema: {
      path: z.string().default(".").describe("Folder relative to workspace root"),
      max_files: z.number().int().min(1).max(200).default(60),
    },
    handler({ path: p, max_files }, { config }) {
      const abs = resolveSafe(config.workspaceRoot, p);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new ToolError(`Directory not found: ${p}`);
      const out: string[] = [];
      let n = 0;
      for (const f of walkFiles(abs)) {
        if (++n > max_files) { out.push(`… more files not shown (max_files=${max_files})`); break; }
        const rel = relPath(config.workspaceRoot, f);
        out.push(rel);
        if (/\.(ts|tsx|js|mjs|py)$/.test(f) && fs.statSync(f).size <= config.maxFileBytes) {
          const lines = fs.readFileSync(f, "utf8").split("\n");
          lines.forEach((l, i) => {
            const m = l.match(SYMBOL_RE);
            if (m && !/^\s{2,}/.test(l)) out.push(`    L${i + 1} ${m[3]} ${m[4]}`);
          });
        }
      }
      return out.length ? out.join("\n") : "No files found.";
    },
  },
];

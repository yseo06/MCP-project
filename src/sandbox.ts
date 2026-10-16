import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export class ToolError extends Error {}

/** Names inside the workspace that file tools may never touch directly. */
const BLOCKED_SEGMENTS = new Set([".git", ".trash"]);

/**
 * Resolve a user-supplied path against the sandbox root.
 * Rejects: absolute paths, NUL bytes, "..", escapes via symlinks, and protected dirs.
 * Returns the absolute path on disk (which may not exist yet).
 */
export function resolveSafe(root: string, input: string): string {
  if (typeof input !== "string" || input.length === 0) throw new ToolError("Path must be a non-empty string.");
  if (input.includes("\0")) throw new ToolError("Path contains a NUL byte.");
  const normalized = input.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
    throw new ToolError("Absolute paths are not allowed. Use a path relative to the workspace root.");
  }
  const target = path.resolve(root, normalized);
  assertInside(root, target, input);

  const rel = path.relative(root, target);
  if (rel.split(path.sep).some((seg) => BLOCKED_SEGMENTS.has(seg))) {
    throw new ToolError(`Path "${input}" is inside a protected directory (.git or .trash).`);
  }

  // Symlink defence: resolve the deepest existing ancestor and re-check.
  let probe = target;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  assertInside(root, fs.realpathSync(probe), input);
  return target;
}

function assertInside(root: string, abs: string, original: string) {
  const rel = path.relative(root, abs);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new ToolError(`Path "${original}" escapes the workspace root and was rejected.`);
  }
}

export function relPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/") || ".";
}

/** Short content hash used for optimistic locking (if_version). */
export function versionOf(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function isProtectedName(name: string): boolean {
  return BLOCKED_SEGMENTS.has(name);
}

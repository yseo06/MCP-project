import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolDef } from "./types.js";
import { versionOf } from "../sandbox.js";

export const HANDOFF_FILES = ["PROJECT_STATE.md", "PLAN_LOG.md", "CHECKPOINTS.md", "DECISIONS.md"] as const;

const TEMPLATES: Record<(typeof HANDOFF_FILES)[number], string> = {
  "PROJECT_STATE.md": `# PROJECT STATE\n\n_Single source of truth. Update with str_replace as work progresses. Keep it short._\n\n## Goal\n(not set)\n\n## Status\nNot started.\n\n## Done\n- \n\n## Next\n- \n\n## Open questions\n- \n`,
  "PLAN_LOG.md": `# PLAN LOG\n\n_Append-only. One entry per plan or change of plan. Use the log_plan tool._\n`,
  "CHECKPOINTS.md": `# CHECKPOINTS\n\n_Append-only. Save one at the end of every session with save_checkpoint so the next session can resume._\n`,
  "DECISIONS.md": `# DECISIONS\n\n_Append-only. Why we chose X over Y. Use the record_decision tool._\n`,
};

export function ensureHandoffFiles(root: string) {
  for (const f of HANDOFF_FILES) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, TEMPLATES[f]);
  }
}

function append(root: string, file: (typeof HANDOFF_FILES)[number], block: string): string {
  const p = path.join(root, file);
  const prev = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : TEMPLATES[file];
  const next = prev.replace(/\n*$/, "\n") + "\n" + block.trim() + "\n";
  fs.writeFileSync(p, next);
  return `Appended to ${file}. version=${versionOf(next)}`;
}

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

export const handoffTools: ToolDef[] = [
  {
    name: "handoff_read",
    access: "read",
    description:
      "Read all four handoff files (PROJECT_STATE, PLAN_LOG, CHECKPOINTS, DECISIONS) in ONE call. Call this first at the start of every session to resume where the last agent stopped. For the append-only logs only the most recent part is returned.",
    inputSchema: {
      tail_chars: z.number().int().min(500).max(8000).default(3000).describe("How much of the end of each log to return"),
    },
    handler({ tail_chars }, { config }) {
      return HANDOFF_FILES.map((f) => {
        const p = path.join(config.workspaceRoot, f);
        if (!fs.existsSync(p)) return `===== ${f} (missing) =====`;
        const text = fs.readFileSync(p, "utf8");
        const isState = f === "PROJECT_STATE.md";
        const body = isState || text.length <= tail_chars ? text : "…(earlier entries omitted)\n" + text.slice(-tail_chars);
        return `===== ${f}  version=${versionOf(text)} =====\n${body}`;
      }).join("\n\n");
    },
  },
  {
    name: "log_plan",
    access: "write",
    description: "Append a timestamped plan entry to PLAN_LOG.md. Call before a multi-step action: what you intend to do and in what order. Append-only; does not touch other content.",
    inputSchema: {
      agent: z.string().min(1).max(40).describe("Your agent or session name, e.g. 'planner-1'"),
      plan: z.string().min(1).max(2000).describe("Numbered steps you intend to take"),
    },
    handler({ agent, plan }, { config }) {
      return append(config.workspaceRoot, "PLAN_LOG.md", `## ${stamp()} · ${agent}\n${plan}`);
    },
  },
  {
    name: "save_checkpoint",
    access: "write",
    description:
      "Append a session checkpoint to CHECKPOINTS.md. Call at the end of a session (or before stopping): what is done, what is in progress, and the exact next step, so a fresh agent can resume without re-reading everything.",
    inputSchema: {
      agent: z.string().min(1).max(40),
      done: z.string().min(1).max(1500).describe("What was completed this session"),
      next: z.string().min(1).max(1500).describe("The exact next step for whoever resumes"),
      blockers: z.string().max(1000).optional(),
    },
    handler({ agent, done, next, blockers }, { config }) {
      const block = `## ${stamp()} · ${agent}\n- DONE: ${done}\n- NEXT: ${next}${blockers ? `\n- BLOCKERS: ${blockers}` : ""}`;
      return append(config.workspaceRoot, "CHECKPOINTS.md", block);
    },
  },
  {
    name: "record_decision",
    access: "write",
    description: "Append a design decision to DECISIONS.md with its rationale, so later agents do not reopen settled questions.",
    inputSchema: {
      agent: z.string().min(1).max(40),
      decision: z.string().min(1).max(500).describe("What was decided"),
      rationale: z.string().min(1).max(1500).describe("Why, and what alternatives were rejected"),
    },
    handler({ agent, decision, rationale }, { config }) {
      return append(config.workspaceRoot, "DECISIONS.md", `## ${stamp()} · ${agent}\n- DECISION: ${decision}\n- WHY: ${rationale}`);
    },
  },
];

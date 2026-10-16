# Midterms Pt 1 Report: MCP Workspace Server

**Name:** Emmanuel Enriquez  **Section:** CS 3A  **Repo:** public  **Public URL:** `https://ramrod-likewise-dispatch.ngrok-free.dev`

## 1. Stack and why

| Layer | Choice | Why (and what I rejected) |
|---|---|---|
| Runtime / SDK | Node.js 22 + official TypeScript MCP SDK | First-class Streamable HTTP support; types catch schema mistakes at compile time. Python/FastMCP is equally valid but I wanted one language for server, tests and demo client. |
| Transport | Streamable HTTP, **stateless** (new server per request) | Needed for a public URL shared by several agents. Stateless means no session table to lose on restart and no way for one caller's role to leak into another's. stdio kept as `--stdio` for local testing. |
| Validation | zod on every tool input | Wrong types and missing fields are rejected before my code runs; `confirm: z.literal(true)` makes deletes explicit. |
| Exposure | ngrok static domain | Stable URL survives restarts so the client config never changes. Cloudflare Tunnel is a drop-in alternative. |
| Process manager | pm2 (server + tunnel) | Auto-restart, memory cap, boot persistence with `pm2 startup`. |
| Version control | Workspace is its own git repo, driven by `execFile` (no shell) | Gives agents `git_commit/log/diff` and gives me an undo button. |
| Config | `.env` + `ecosystem.config.cjs` | No secrets in code; rebuild from README alone. |

## 2. Tool design choices

- 15 single-purpose tools; verbs are stable (`read_file`, `str_replace`) because agents and logs refer to them.
- **Descriptions are prompts:** each says what the tool does, when to use it, and how it fails.
- **Chunked reads + `search_code` + `repo_map`** keep results small. `handoff_read` returns four files in one call (cost of resuming: 1 call).
- **`if_version` (content hash)** is optimistic locking: two agents editing the same file cannot silently overwrite each other (stretch goal, implemented and tested).
- **Errors are instructions:** `isError: true` plus a message naming the fix. Internal errors return a generic message; the stack stays in the server console.
- Output capped at 20k chars with a hint to narrow the request, so one call can't flood the model's context.
- Roles shape `tools/list` itself: least privilege is enforced by absence, not by a polite refusal.

## 3. Security tradeoffs and threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Path traversal (`../`, absolute, `\`, NUL) | `resolveSafe` + 14 attack tests | Relies on Node path semantics; covered by tests on Linux only. |
| Symlink escape | `realpath` of deepest existing ancestor, re-checked | Race between check and use (TOCTOU) is theoretically possible; agents cannot create symlinks via these tools. |
| Open public endpoint | Mandatory tokens, constant-time compare, 401 otherwise | Token in `/t/<token>/` form can show up in proxy logs; header form preferred. Static bearer tokens have no expiry: rotate manually. |
| Prompt injection via file content | Roles limit blast radius; worker cannot delete; all calls logged | A malicious file could still persuade a *worker* agent to edit other workspace files. Review diffs before trusting. |
| Destructive actions | Admin-only, `confirm`, soft-delete to `.trash`, handoff files protected | Admin token is powerful: keep it out of agent configs. |
| Resource abuse | 1 MB files, 20k output, 300 req/min/IP | In-memory limiter resets on restart and is per-IP only. |
| Tampering with history | `.git` is unreachable by file tools | An admin with host access can still rewrite it. |

**Trade-off I accepted:** simple static tokens instead of OAuth. Far less setup, but weaker identity and no per-user audit.

## 4. Efficiency evidence (fill in from your own real-client run)

- Task: Built a greeting CLI with error handling across three sessions  Sessions: 3  Total tool calls: 19  Errors: 0 (recovered: 0)
- Reference scripted run (`docs/TRANSCRIPT.md`): 25 calls, 2 sessions; resumed from `handoff_read` alone; read 5 lines instead of the whole file; one `if_version` conflict recovered by re-read + retry.
- Live run (`docs/LIVE_TRANSCRIPT.md`): 19 calls, 3 sessions; 4 version-pinned `str_replace` edits; 2 handoff resumptions; 2 git commits (`2ec6454`, `00e1b23`); 0 errors.
- What I would change after reading my own logs: Claude never used `log_plan` or `record_decision` until explicitly told to in a third session. I would add those tools to the prompt template in `docs/AGENT_PROMPT.md` so they are used automatically. I would also consider adding a `run_command` tool for script execution so agents can verify their own output.

## 5. Reflection (3-5 sentences)

I was surprised that Claude naturally chained `if_version` hashes across sequential `str_replace` calls without being told to — the tool description alone drove the optimistic-locking behavior. It also always read files before editing, even when it had just written them, because each `str_replace` returned a new version hash it needed. The biggest gap was that Claude only used the tools I explicitly asked for: `DECISIONS.md` and `PLAN_LOG.md` stayed empty through two full coding sessions because the prompt never mentioned `record_decision` or `log_plan`. This taught me that tool *descriptions* guide how a tool is used, but the *prompt* determines whether it is used at all. If I were to redo the exercise, I would bake those tool names into the system prompt so documentation happens automatically. I also rewrote the `str_replace` description mentally after seeing how Claude handled it — the phrase "old_str must appear exactly once" was the single most important constraint, because it forced Claude to include enough surrounding context to make each replacement unambiguous.

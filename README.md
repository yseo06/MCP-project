# MCP Workspace Server

A sandboxed **Model Context Protocol** file-server connector: shared memory for you and your AI agents.
Agents read, search, edit and commit files inside one folder, and hand work to each other through four
state files, so a brand-new session can resume exactly where the last one stopped.

*CS 3A/3B · Week 06 · Midterms Pt 1*

```
 MCP client (Claude, IDE, your agent)
        │  HTTPS + Bearer token (or secret path)
        ▼
 ngrok / Cloudflare tunnel ──► pm2 ──► Node.js + TypeScript MCP SDK (Streamable HTTP, stateless)
                                          │ role → tools (reader / worker / admin)
                                          │ zod validates every input
                                          ▼
                                   sandbox.ts  (resolveSafe)  ──►  workspace/  (its own git repo)
                                          │                         PROJECT_STATE · PLAN_LOG
                                          └─► logs/calls.jsonl       CHECKPOINTS · DECISIONS
```

## Quick start (5 minutes)

```bash
npm install
cp .env.example .env        # then edit .env: set 3 long random tokens
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # run 3 times
npm run dev                 # http://localhost:3000/healthz -> {"ok":true}
npm test                    # 28 tests
```

Inspect it (Milestone 1/2 check):

```bash
npm run inspect
# Transport: Streamable HTTP   URL: http://localhost:3000/mcp
# Header:    Authorization: Bearer <your worker token>
```

## Tools (15)

| Tool | Role needed | What it does |
|---|---|---|
| `list_files` | reader | Directory listing, depth 1-4, capped |
| `read_file` | reader | Numbered lines in **chunks**; returns a `version` hash |
| `search_code` | reader | Text/regex search with glob, capped results |
| `repo_map` | reader | Tree + top-level functions/classes per file |
| `git_status` / `git_diff` / `git_log` | reader | Inspect the workspace repo |
| `handoff_read` | reader | All 4 handoff files in **one call** |
| `write_file` | worker | Create/overwrite; optional `if_version` lock |
| `str_replace` | worker | Replace one *unique* occurrence; optional `if_version` |
| `git_commit` | worker | Stage (all or listed paths) and commit |
| `log_plan` / `save_checkpoint` / `record_decision` | worker | Append-only entries in the handoff files |
| `delete_file` | **admin** | Moves to `.trash/` (recoverable); needs `confirm: true` |

Failures come back as `isError: true` with a message the agent can act on (e.g. *"old_str matches 2 places.
Include more surrounding text"*). Stack traces never leave the server.

## Roles and tokens

`MCP_TOKENS=admin:xxx,worker:yyy,reader:zzz`. The server builds a **different tool list per role**: a reader never
sees `write_file`; a worker never sees `delete_file`. Give each agent the lowest role that does its job.

## Security model

- **Sandbox:** every path goes through `resolveSafe()`: rejects absolute paths, `..`, NUL bytes, Windows drives,
  symlinks that lead outside the root (checked via `realpath` of the deepest existing ancestor), and `.git` / `.trash`.
- **Auth:** the endpoint refuses to start with no tokens; tokens ≥16 chars; constant-time comparison.
  Send as `Authorization: Bearer …` or use the secret-path form `/t/<token>/mcp` for clients that cannot set headers.
- **Destructive actions:** admin-only, explicit `confirm`, soft delete, handoff files undeletable, every call logged.
- **Limits:** 1 MB per file, 20k chars per response, 300 req/min/IP, 2 MB request body.
- **Secrets** live in `.env` (git-ignored), never in code or `ecosystem.config.cjs`.
- Secret-path URLs can appear in proxy logs, so prefer the header when your client supports it and rotate tokens if exposed.

## Deploy (Milestone 3)

```bash
npm run build
npm i -g pm2
ngrok config add-authtoken <your token>        # once; reserve a free static domain in the ngrok dashboard
export NGROK_DOMAIN=your-name.ngrok-free.app
pm2 start ecosystem.config.cjs                 # runs server AND tunnel
pm2 save && pm2 startup                        # survive reboot (run the command it prints)
curl https://$NGROK_DOMAIN/healthz
```

Cloudflare Tunnel alternative: `cloudflared tunnel --url http://localhost:3000` (swap the `mcp-tunnel` entry).

## Connect a real client

- **Claude (custom connector):** Settings → Connectors → Add custom connector → URL
  `https://YOUR-DOMAIN/t/<worker-token>/mcp`.
- **MCP Inspector:** URL `https://YOUR-DOMAIN/mcp`, header `Authorization: Bearer <token>`.
- **Claude Desktop (local, stdio):** `{"mcpServers":{"ws":{"command":"node","args":["/abs/path/dist/index.js","--stdio"],"env":{"WORKSPACE_ROOT":"/abs/path/workspace","STDIO_ROLE":"worker"}}}}`

## The handoff protocol (how agents share context)

Start of session → `handoff_read` (one call). During work → `log_plan` before multi-step actions, `record_decision`
for choices, edit **PROJECT_STATE.md** with `str_replace` (+ `if_version`). End of session → `git_commit`, then `save_checkpoint`
with an exact NEXT step. Paste `docs/AGENT_PROMPT.md` into each agent's system prompt.

## Testing and evidence

| Milestone | Check |
|---|---|
| M1 Skeleton | `npm run dev` + Inspector lists tools, `list_files` answers |
| M2 Sandbox | `npm test`: 14 path-attack cases, symlink escape, every tool rejects traversal |
| M3 Deploy | `curl https://DOMAIN/healthz`, then a real client lists tools; `pm2 restart all` and reconnect |
| M4 Protocol | `test/tools.test.ts`: handoff, git, version locking |
| M5 Prove it | `npm run demo` (scripted) **and** the same task with a real LLM client across 2+ chats → save its log |

`docs/TRANSCRIPT.md` and `docs/evidence/` hold a reference run (25 calls, 2 sessions, 1 recovered conflict, 3 blocked attacks).
`logs/calls.jsonl` records role, tool, args, duration and result size for every call.

## Layout

```
src/config.ts      env + token parsing        src/tools/files.ts    file tools
src/sandbox.ts     path safety + versions     src/tools/search.ts   search_code, repo_map
src/logger.ts      JSONL call log             src/tools/git.ts      git-lite
src/server.ts      role→tools, error shaping  src/tools/handoff.ts  handoff tools
src/index.ts       HTTP/stdio entry           test/  scripts/demo.ts  docs/
```

## Troubleshooting

- `401` → wrong/missing token. `Refusing to start` → `MCP_TOKENS` empty. `git error` → install git on the host.
- Client can't connect through ngrok → check `curl https://DOMAIN/healthz` first; free-tier interstitials affect browsers, not API clients.

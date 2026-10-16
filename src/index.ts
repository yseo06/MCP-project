import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Role } from "./config.js";
import { createServer } from "./server.js";
import { initLogger } from "./logger.js";
import { ensureGitRepo } from "./tools/git.js";
import { ensureHandoffFiles } from "./tools/handoff.js";

const config = loadConfig();
initLogger(config.logFile);
ensureHandoffFiles(config.workspaceRoot);
ensureGitRepo(config.workspaceRoot);

if (process.argv.includes("--stdio")) {
  // Local-only mode: the host spawns us, so it inherits the user's trust.
  const role = (process.env.STDIO_ROLE as Role) ?? "admin";
  await createServer(config, role).connect(new StdioServerTransport());
  console.error(`[stdio] workspace=${config.workspaceRoot} role=${role}`);
} else {
  if (config.tokens.size === 0) {
    console.error("Refusing to start: MCP_TOKENS is empty. Set at least one role:token pair (see .env.example).");
    process.exit(1);
  }

  const safeEqual = (a: string, b: string) => {
    const ha = crypto.createHash("sha256").update(a).digest();
    const hb = crypto.createHash("sha256").update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  const roleForToken = (token: string): Role | null => {
    let found: Role | null = null;
    for (const [t, r] of config.tokens) if (safeEqual(t, token)) found = r; // no early exit
    return found;
  };

  // Very small in-memory rate limit per IP: 300 requests / minute.
  const hits = new Map<string, { n: number; reset: number }>();
  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "?";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) hits.set(key, { n: 1, reset: now + 60_000 });
    else if (++h.n > 300) return res.status(429).json({ error: "Too many requests" });
    next();
  };

  const app = express();
  app.set("trust proxy", 1); // behind ngrok / cloudflared
  app.use(express.json({ limit: "2mb" }));
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  /** Token from "Authorization: Bearer x" OR from a secret path /t/<token>/mcp (for clients that cannot set headers). */
  async function handle(req: Request, res: Response) {
    const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = (req.params.token as string | undefined) ?? bearer;
    const role = token ? roleForToken(token) : null;
    if (!role) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    // Stateless: a fresh server + transport per request, so a role can never leak between callers.
    const server = createServer(config, role);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
  const notAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });

  app.post("/mcp", rateLimit, handle);
  app.post("/t/:token/mcp", rateLimit, handle);
  for (const p of ["/mcp", "/t/:token/mcp"]) { app.get(p, notAllowed); app.delete(p, notAllowed); }

  app.listen(config.port, () => {
    console.log(`MCP workspace server on :${config.port}  workspace=${config.workspaceRoot}`);
    console.log(`Roles configured: ${[...new Set(config.tokens.values())].join(", ")}`);
  });
}

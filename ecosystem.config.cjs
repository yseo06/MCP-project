// pm2 process definitions. Start with:  pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
// Secrets are read from .env (never hardcoded here).
module.exports = {
  apps: [
    {
      name: "mcp-server",
      script: "dist/index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
    {
      // ngrok with a static domain. Set NGROK_DOMAIN and run `ngrok config add-authtoken ...` once.
      name: "mcp-tunnel",
      script: "ngrok",
      args: `http --domain=${process.env.NGROK_DOMAIN || "YOUR-STATIC-DOMAIN.ngrok-free.app"} ${process.env.PORT || 3000}`,
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
    },
  ],
};

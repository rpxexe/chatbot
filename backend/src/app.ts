import express from "express";
import { publicRouter, adminRouter, errorHandler } from "./routes.js";
import { pool } from "./db.js";
import { resendInbound } from "./inbound.js";

export const app = express();
// Before express.json: the signature check needs the exact raw body.
app.post("/api/inbound/resend", express.raw({ type: "*/*", limit: "1mb" }), (req, res, next) => { resendInbound(req, res).catch(next); });
app.use(express.json({ limit: "2mb" }));
// Uptime check for Railway/monitors. 503 when Postgres is unreachable, so a broken DB marks the service unhealthy.
// Also under /api so it can be reached through the frontend's /api proxy.
app.get(["/health", "/api/health"], async (_req, res) => {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up", dbLatencyMs: Date.now() - started, uptimeS: Math.round(process.uptime()) });
  } catch {
    res.status(503).json({ ok: false, db: "down" });
  }
});
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);
app.use(errorHandler);

import express from "express";
import { publicRouter, adminRouter, errorHandler } from "./routes.js";

export const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/admin", adminRouter);
app.use("/api", publicRouter);
app.use(errorHandler);

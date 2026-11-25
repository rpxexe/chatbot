// Email replies into handoff threads. A visitor's reply email goes to reply+<ticket id>@RESEND_INBOUND_DOMAIN (the
// reply-to of every email they get from us, see mail.ts). Resend receives it and calls this webhook with the
// `email.received` event; the webhook carries only metadata, so the body is fetched from Resend's API.
// Setup: Resend dashboard > Webhooks > add <backend URL>/api/inbound/resend for `email.received`, and put its signing
// secret in RESEND_WEBHOOK_SECRET.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "./db.js";

const TOLERANCE_S = 5 * 60;
const REPLY_TO = /^reply\+([0-9a-f-]{36})@/i;

/** Svix signature check (Resend signs webhooks with Svix): HMAC-SHA256 of "id.timestamp.body", base64, "v1,<sig>". */
export function verifySvix(raw: string, headers: { id?: string; timestamp?: string; signature?: string }, secret: string, now = Date.now()): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** The new part of a reply: drops the quoted earlier email ("On … wrote:" and "> " lines) and a "-- " signature. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^From: /.test(line) || line === "-- ") break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

const address = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase();
const htmlToText = (html: string) =>
  html.replace(/<(br|\/p|\/div)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export async function resendInbound(req: Request, res: Response) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const key = process.env.RESEND_API_KEY;
  if (!secret || !key) return res.status(503).json({ error: "email replies are not configured" });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const ok = verifySvix(raw, { id: req.get("svix-id"), timestamp: req.get("svix-timestamp"), signature: req.get("svix-signature") }, secret);
  if (!ok) return res.status(401).json({ error: "bad signature" });

  const event = JSON.parse(raw);
  // Anything we don't handle is acknowledged, so Resend doesn't retry it.
  if (event.type !== "email.received") return res.status(204).end();
  const data = event.data ?? {};
  const ticketId = [...(data.to ?? []), ...(data.received_for ?? [])].map(address).map((a: string) => a.match(REPLY_TO)?.[1]).find(Boolean);
  if (!ticketId) return res.status(204).end();

  const { rows: [t] } = await pool.query("SELECT email FROM tickets WHERE id = $1", [ticketId]);
  // Only the visitor who opened the ticket can add to it: a guessed or leaked address from anyone else is ignored.
  if (!t?.email || address(String(data.from ?? "")) !== t.email.toLowerCase()) return res.status(204).end();

  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(data.email_id)}`, {
    headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000),
  });
  // 502: Resend retries the webhook later.
  if (!r.ok) return res.status(502).json({ error: `could not fetch the email (${r.status})` });
  const email = await r.json();
  const body = stripQuoted(email.text ?? htmlToText(email.html ?? "")).slice(0, 5000);
  if (!body) return res.status(204).end();

  await pool.query(
    `WITH t AS (UPDATE tickets SET updated_at = now(), status = 'open' WHERE id = $1 RETURNING id)
     INSERT INTO ticket_messages (ticket_id, author, body, channel) SELECT id, 'visitor', $2, 'email' FROM t`,
    [ticketId, body],
  );
  res.status(204).end();
}

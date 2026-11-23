// Human handoff: when the bot has no answer, or the visitor asks for a person, the chat response offers the knowledge
// base's contact channels. Email, contact form and WhatsApp are links the client builds; "ticket" and "live" use the
// built-in ticket thread (tickets + ticket_messages): the visitor writes, an agent replies from the admin dashboard.
// In live mode the widget polls the thread while it is open; in ticket mode the visitor leaves an email for the reply.
import { HttpError } from "./extract.js";
import type { ConversationResult } from "./context.js";

export type HandoffSettings = { email?: string; contactUrl?: string; whatsapp?: string; ticket?: boolean; live?: boolean };
export type Handoff = HandoffSettings & {
  /** "unanswered": nothing reliable in the knowledge base. "requested": the visitor asked for a person. */
  reason: "unanswered" | "requested";
  /** The visitor's message, to prefill an email, WhatsApp message or ticket. */
  question: string;
};

export const REQUESTED_ANSWER = "Of course. You can reach our team using one of the options below.";

const bad = (msg: string) => new HttpError(400, msg);
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates admin input. Empty strings clear a channel; unknown keys are rejected. */
export function parseHandoff(v: unknown): HandoffSettings {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("handoff must be an object");
  const allowed = ["email", "contactUrl", "whatsapp", "ticket", "live"];
  const extra = Object.keys(v).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`unknown handoff field: ${extra.join(", ")}`);
  const o = v as Record<string, unknown>;
  const text = (k: string) => {
    if (o[k] == null || o[k] === "") return undefined;
    if (typeof o[k] !== "string") throw bad(`handoff.${k} must be a string`);
    return (o[k] as string).trim() || undefined;
  };
  const out: HandoffSettings = {};
  const email = text("email");
  if (email) {
    if (email.length > 254 || !EMAIL.test(email)) throw bad("handoff.email must be an email address");
    out.email = email;
  }
  const url = text("contactUrl");
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch { throw bad("handoff.contactUrl must be a URL"); }
    if (!/^https?:$/.test(u.protocol) || url.length > 500) throw bad("handoff.contactUrl must be an http(s) URL");
    out.contactUrl = u.href;
  }
  const wa = text("whatsapp");
  if (wa) {
    const digits = wa.replace(/[\s()+.-]/g, "");
    if (!/^\d{7,15}$/.test(digits)) throw bad("handoff.whatsapp must be a phone number in international format, e.g. +44 7700 900123");
    out.whatsapp = digits;
  }
  for (const k of ["ticket", "live"] as const) {
    if (o[k] == null) continue;
    if (typeof o[k] !== "boolean") throw bad(`handoff.${k} must be true or false`);
    if (o[k]) out[k] = true;
  }
  return out;
}

/** The handoff to attach to a chat result, or null when the bot answered or the knowledge base has no channels. */
export function offer(settings: HandoffSettings, r: ConversationResult, message: string): Handoff | null {
  const hasChannel = !!(settings.email || settings.contactUrl || settings.whatsapp || settings.ticket || settings.live);
  const requested = r.intent?.name === "human_agent";
  if (!hasChannel || (!requested && r.level !== "low")) return null;
  return { reason: requested ? "requested" : "unanswered", question: message, ...settings };
}

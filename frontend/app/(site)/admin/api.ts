import type { Appearance } from "@/lib/appearance";
/** Contact channels offered when the bot can't answer (see backend/src/handoff.ts). */
export type Handoff = { email?: string; contactUrl?: string; whatsapp?: string; ticket?: boolean; live?: boolean };
export type Kb = {
  id: number; name: string; slug: string; faq_count: number; document_count: number; open_tickets: number; handoff: Handoff;
  /** Origins allowed to embed the chatbot; empty = any. */
  websites: string[];
  /** Customize tab: widget theme, accent, side, texts. */
  appearance: Appearance;
};
export type Category = { id: number; name: string; faq_count: number; document_count: number };
export type Faq = {
  id: number; question: string; answer: string; keywords: string[]; enabled: boolean; category: string | null;
  intent_id: number | null; intent: string | null;
};
export type Doc = {
  id: number; title: string; enabled: boolean; source_type: "file" | "url" | "manual"; source_name: string | null;
  category: string | null; section_count: number; created_at: string; intent_id: number | null; intent: string | null;
  /** The original upload is kept in storage and can be downloaded. */
  has_file: boolean;
};
export type Intent = {
  id: number; name: string; patterns: string[]; response: string | null; enabled: boolean; faq_count: number; document_count: number;
};
export type Section = { id: number; heading: string; body: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** The admin token, or a function returning a fresh Clerk session token (they expire after a minute). */
export type Token = string | (() => Promise<string | null>);

const bearer = async (token: Token) => `Bearer ${typeof token === "string" ? token : (await token()) ?? ""}`;

/** Calls /api/admin with the bearer token. JSON bodies are serialised; FormData is sent as-is. */
export async function api<T = any>(token: Token, path: string, method = "GET", body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { authorization: await bearer(token), ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

export const splitKeywords = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** Downloads an admin file. A plain link can't carry the bearer token, so fetch it and save the blob. */
export async function download(token: Token, path: string, filename: string) {
  const res = await fetch(`/api/admin${path}`, { headers: { authorization: await bearer(token) } });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? `Download failed (${res.status})`);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await res.blob()), download: filename });
  a.click();
  URL.revokeObjectURL(a.href);
}

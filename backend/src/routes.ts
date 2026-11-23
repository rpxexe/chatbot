import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import multer from "multer";
import { pool, tx, categoryId, insertDocument, insertFaq, insertDefaultIntents } from "./db.js";
import { chat, UUID } from "./context.js";
import { EMAIL, offer, parseHandoff, REQUESTED_ANSWER } from "./handoff.js";
import { logQuestion, markReviewed, report } from "./analytics.js";
import { extract, extractFetched, markdownToSections, HttpError, type Extracted } from "./extract.js";
import { fetchUrl } from "./fetch-url.js";
import { DEFAULT_SYNONYMS } from "./engine/synonyms.js";

// ---------- validation ----------

const bad = (msg: string) => new HttpError(400, msg);

function str(v: unknown, field: string, max: number, required = true): string | null {
  if (v == null || v === "") {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  if (typeof v !== "string" || v.trim().length === 0) throw bad(`${field} must be a non-empty string`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters`);
  return v.trim();
}

function keywords(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((k) => typeof k === "string")) throw bad("keywords must be an array of strings");
  return [...new Set(v.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function bool(v: unknown, field: string) {
  if (typeof v !== "boolean") throw bad(`${field} must be true or false`);
  return v;
}

function intParam(req: Request, name = "id") {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n < 1) throw bad(`invalid ${name}`);
  return n;
}

async function kbFromParam(req: Request) {
  const id = intParam(req, "kb");
  const { rowCount } = await pool.query("SELECT 1 FROM knowledge_bases WHERE id = $1", [id]);
  if (!rowCount) throw new HttpError(404, "knowledge base not found");
  return id;
}

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

/** UPDATE only the fields present in the body. `fields` maps body key -> [column, parser]. */
async function patchRow(
  table: "faqs" | "documents" | "sections" | "categories" | "knowledge_bases" | "synonyms" | "intents",
  id: number,
  body: any,
  fields: Record<string, [string, (v: unknown) => unknown]>,
  touch = false,
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, [col, parse]] of Object.entries(fields)) {
    if (body && key in body) {
      vals.push(await parse(body[key]));
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (sets.length === 0) throw bad(`nothing to update; allowed fields: ${Object.keys(fields).join(", ")}`);
  if (touch) sets.push("updated_at = now()");
  vals.push(id);
  const { rowCount } = await pool.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  if (!rowCount) throw new HttpError(404, "not found");
}

async function kbOf(table: "faqs" | "documents", id: number) {
  const { rows } = await pool.query(`SELECT kb_id FROM ${table} WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "not found");
  return rows[0].kb_id as number;
}

async function del(table: string, id: number, res: Response) {
  const { rowCount } = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  if (!rowCount) throw new HttpError(404, "not found");
  res.status(204).end();
}

// ---------- public ----------

export const publicRouter = Router();

// The website widget (frontend/public/widget.js) calls chat from customers' own domains. The endpoint is public and
// uses no cookies or auth, so any origin may call it. Only /chat gets these headers, never the admin API.
const cors = (_req: Request, res: Response, next: NextFunction) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
  });
  next();
};
publicRouter.options(["/chat", "/tickets", "/tickets/:id", "/tickets/:id/messages"], cors, (_req, res) => { res.status(204).end(); });

publicRouter.post("/chat", cors, async (req, res) => {
  const message = str(req.body?.message, "message", 500)!;
  // `knowledgeBaseId` (widget API) and `kb` are the same thing: the knowledge base's public slug.
  const slug = str(req.body?.knowledgeBaseId ?? req.body?.kb, "knowledgeBaseId", 50, false) ?? "default";
  const { rows } = await pool.query("SELECT id, handoff FROM knowledge_bases WHERE slug = $1", [slug]);
  if (!rows[0]) throw new HttpError(404, `knowledge base "${slug}" not found`);
  // Unknown, expired or malformed ids start a new conversation; the response carries the id to send next time.
  const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : undefined;
  const result = await chat(message, rows[0].id, conversationId);
  // The admin preview sends preview: true so the owner's own test questions don't skew analytics.
  if (req.body?.preview !== true) await logQuestion(rows[0].id, message, result);
  const handoff = offer(rows[0].handoff, result, message);
  // Asked for a person and nothing in the knowledge base answers it: say so instead of "couldn't find an answer".
  const answer = handoff?.reason === "requested" && !result.found ? REQUESTED_ANSWER : result.answer;
  res.json({ ...result, answer, handoff });
});

// Tickets: the visitor side of a handoff thread. The ticket id (random UUID) is the visitor's only key to it.

async function openKb(slug: string) {
  const { rows } = await pool.query("SELECT id, handoff FROM knowledge_bases WHERE slug = $1", [slug]);
  if (!rows[0]) throw new HttpError(404, `knowledge base "${slug}" not found`);
  return rows[0] as { id: number; handoff: { ticket?: boolean; live?: boolean } };
}

function ticketId(req: Request) {
  if (!UUID.test(req.params.id as string)) throw new HttpError(404, "ticket not found");
  return req.params.id as string;
}

const messages = async (id: string) => (await pool.query(
  `SELECT id::int, author, body, created_at AS "createdAt" FROM ticket_messages WHERE ticket_id = $1 ORDER BY id`, [id],
)).rows;

publicRouter.post("/tickets", cors, async (req, res) => {
  const kb = await openKb(str(req.body?.knowledgeBaseId ?? req.body?.kb, "knowledgeBaseId", 50, false) ?? "default");
  const live = req.body?.live === true;
  if (live ? !kb.handoff.live : !kb.handoff.ticket) throw new HttpError(403, `${live ? "live agents are" : "tickets are"} not enabled for this knowledge base`);
  const message = str(req.body?.message, "message", 2000)!;
  const name = str(req.body?.name, "name", 100, false);
  // A ticket is answered later, so it needs an address; a live chat can go without one.
  const email = str(req.body?.email, "email", 254, !live);
  if (email && !EMAIL.test(email)) throw bad("email must be an email address");
  const conv = typeof req.body?.conversationId === "string" && UUID.test(req.body.conversationId) ? req.body.conversationId : null;
  const id = await tx(async (c) => {
    const { rows } = await c.query(
      "INSERT INTO tickets (kb_id, conversation_id, name, email, live) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [kb.id, conv, name, email, live],
    );
    await c.query("INSERT INTO ticket_messages (ticket_id, author, body) VALUES ($1, 'visitor', $2)", [rows[0].id, message]);
    return rows[0].id as string;
  });
  res.status(201).json({ id, live, status: "open", messages: await messages(id) });
});

publicRouter.get("/tickets/:id", cors, async (req, res) => {
  const id = ticketId(req);
  const { rows } = await pool.query("SELECT live, status FROM tickets WHERE id = $1", [id]);
  if (!rows[0]) throw new HttpError(404, "ticket not found");
  res.json({ id, ...rows[0], messages: await messages(id) });
});

publicRouter.post("/tickets/:id/messages", cors, async (req, res) => {
  const id = ticketId(req);
  const body = str(req.body?.message, "message", 2000)!;
  const { rowCount } = await pool.query(
    `WITH t AS (UPDATE tickets SET updated_at = now() WHERE id = $1 AND status = 'open' RETURNING id)
     INSERT INTO ticket_messages (ticket_id, author, body) SELECT id, 'visitor', $2 FROM t`,
    [id, body],
  );
  if (!rowCount) throw new HttpError(409, "this conversation is closed");
  res.status(201).json({ messages: await messages(id) });
});

// ---------- admin ----------

export const adminRouter = Router();

const sha = (s: string) => createHash("sha256").update(s).digest();

adminRouter.use((req: Request, res: Response, next: NextFunction) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return res.status(503).json({ error: "ADMIN_TOKEN is not configured on the server" });
  const given = req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(sha(given), sha(token))) return res.status(401).json({ error: "invalid admin token" });
  next();
});

// Knowledge bases

adminRouter.get("/kbs", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT k.id, k.name, k.slug, k.created_at,
            (SELECT count(*)::int FROM faqs f WHERE f.kb_id = k.id) AS faq_count,
            (SELECT count(*)::int FROM documents d WHERE d.kb_id = k.id) AS document_count,
            (SELECT count(*)::int FROM tickets t WHERE t.kb_id = k.id AND t.status = 'open') AS open_tickets,
            k.handoff
       FROM knowledge_bases k ORDER BY k.id`,
  );
  res.json(rows);
});

adminRouter.post("/kbs", async (req, res) => {
  const name = str(req.body?.name, "name", 100)!;
  const slug = slugify(str(req.body?.slug, "slug", 50, false) ?? name);
  if (!slug) throw bad("slug must contain letters or digits");
  const kb = await tx(async (c) => {
    const { rows } = await c.query("INSERT INTO knowledge_bases (name, slug) VALUES ($1, $2) RETURNING id, slug", [name, slug]);
    await insertDefaultIntents(c, rows[0].id);
    return rows[0];
  });
  res.status(201).json(kb);
});

adminRouter.patch("/kbs/:id", async (req, res) => {
  await patchRow("knowledge_bases", intParam(req), req.body, { name: ["name", (v) => str(v, "name", 100)], handoff: ["handoff", parseHandoff] });
  res.json({ ok: true });
});

adminRouter.delete("/kbs/:id", async (req, res) => del("knowledge_bases", intParam(req), res));

// Categories

adminRouter.get("/kbs/:kb/categories", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.name,
            (SELECT count(*)::int FROM faqs f WHERE f.category_id = c.id) AS faq_count,
            (SELECT count(*)::int FROM documents d WHERE d.category_id = c.id) AS document_count
       FROM categories c WHERE c.kb_id = $1 ORDER BY c.name`,
    [await kbFromParam(req)],
  );
  res.json(rows);
});

adminRouter.patch("/categories/:id", async (req, res) => {
  await patchRow("categories", intParam(req), req.body, { name: ["name", (v) => str(v, "name", 100)] });
  res.json({ ok: true });
});

// Content in a deleted category becomes uncategorised (FK is ON DELETE SET NULL).
adminRouter.delete("/categories/:id", async (req, res) => del("categories", intParam(req), res));

// Synonyms (built-in groups apply everywhere; these add to them per knowledge base)

function terms(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) throw bad("terms must be an array of strings");
  const out = [...new Set(v.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  if (out.length < 2) throw bad("a synonym group needs at least 2 different terms");
  if (out.length > 30 || out.some((t) => t.length > 100)) throw bad("at most 30 terms of up to 100 characters each");
  return out;
}

adminRouter.get("/kbs/:kb/synonyms", async (req, res) => {
  const { rows } = await pool.query("SELECT id, terms FROM synonyms WHERE kb_id = $1 ORDER BY id", [await kbFromParam(req)]);
  res.json({ custom: rows, builtin: DEFAULT_SYNONYMS });
});

adminRouter.post("/kbs/:kb/synonyms", async (req, res) => {
  const { rows } = await pool.query("INSERT INTO synonyms (kb_id, terms) VALUES ($1, $2) RETURNING id", [await kbFromParam(req), terms(req.body?.terms)]);
  res.status(201).json({ id: rows[0].id });
});

adminRouter.patch("/synonyms/:id", async (req, res) => {
  await patchRow("synonyms", intParam(req), req.body, { terms: ["terms", terms] });
  res.json({ ok: true });
});

adminRouter.delete("/synonyms/:id", async (req, res) => del("synonyms", intParam(req), res));

// Intents

function intentName(v: unknown) {
  const s = str(v, "name", 50)!.toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(s)) throw bad("name may only contain a-z, 0-9, _ and -");
  return s;
}

function patterns(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) throw bad("patterns must be an array of strings");
  const out = [...new Set(v.map((t) => t.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  if (out.length < 1) throw bad("an intent needs at least 1 pattern");
  if (out.length > 100 || out.some((t) => t.length > 100)) throw bad("at most 100 patterns of up to 100 characters each");
  return out;
}

/** Parses an intent_id from a body and checks it belongs to the knowledge base. null clears it. */
async function intentRef(v: unknown, kbId: number): Promise<number | null> {
  if (v == null || v === "") return null;
  const id = Number(v);
  if (!Number.isInteger(id) || id < 1) throw bad("intent_id must be an intent id or null");
  const { rowCount } = await pool.query("SELECT 1 FROM intents WHERE id = $1 AND kb_id = $2", [id, kbId]);
  if (!rowCount) throw bad("intent_id does not belong to this knowledge base");
  return id;
}

adminRouter.get("/kbs/:kb/intents", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT i.id, i.name, i.patterns, i.response, i.enabled,
            (SELECT count(*)::int FROM faqs f WHERE f.intent_id = i.id) AS faq_count,
            (SELECT count(*)::int FROM documents d WHERE d.intent_id = i.id) AS document_count
       FROM intents i WHERE i.kb_id = $1 ORDER BY i.name`,
    [await kbFromParam(req)],
  );
  res.json(rows);
});

adminRouter.post("/kbs/:kb/intents", async (req, res) => {
  const b = req.body ?? {};
  const { rows } = await pool.query(
    "INSERT INTO intents (kb_id, name, patterns, response, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [await kbFromParam(req), intentName(b.name), patterns(b.patterns), str(b.response, "response", 5000, false),
      b.enabled == null ? true : bool(b.enabled, "enabled")],
  );
  res.status(201).json({ id: rows[0].id });
});

adminRouter.patch("/intents/:id", async (req, res) => {
  await patchRow("intents", intParam(req), req.body, {
    name: ["name", intentName],
    patterns: ["patterns", patterns],
    response: ["response", (v) => str(v, "response", 5000, false)],
    enabled: ["enabled", (v) => bool(v, "enabled")],
  });
  res.json({ ok: true });
});

// Tagged FAQs/documents keep their content; the tag is cleared (FK is ON DELETE SET NULL).
adminRouter.delete("/intents/:id", async (req, res) => del("intents", intParam(req), res));

// FAQs

adminRouter.get("/kbs/:kb/faqs", async (req, res) => {
  const kb = await kbFromParam(req);
  const cat = str(req.query.category, "category", 100, false);
  const q = str(req.query.q, "q", 200, false);
  const { rows } = await pool.query(
    `SELECT f.id, f.question, f.answer, f.keywords, f.enabled, c.name AS category, f.intent_id, i.name AS intent, f.updated_at
       FROM faqs f LEFT JOIN categories c ON c.id = f.category_id LEFT JOIN intents i ON i.id = f.intent_id
      WHERE f.kb_id = $1
        AND ($2::text IS NULL OR c.name = $2)
        AND ($3::text IS NULL OR f.question ILIKE '%' || $3 || '%' OR f.answer ILIKE '%' || $3 || '%')
      ORDER BY f.id`,
    [kb, cat, q?.replace(/[\\%_]/g, "\\$&") ?? null],
  );
  res.json(rows);
});

adminRouter.post("/kbs/:kb/faqs", async (req, res) => {
  const b = req.body ?? {};
  const kbId = await kbFromParam(req);
  const id = await insertFaq(pool, {
    kbId,
    question: str(b.question, "question", 1000)!,
    answer: str(b.answer, "answer", 10000)!,
    category: str(b.category, "category", 100, false),
    keywords: keywords(b.keywords),
    enabled: b.enabled == null ? true : bool(b.enabled, "enabled"),
    intentId: await intentRef(b.intent_id, kbId),
  });
  res.status(201).json({ id });
});

adminRouter.patch("/faqs/:id", async (req, res) => {
  const id = intParam(req);
  const kb = await kbOf("faqs", id);
  await patchRow("faqs", id, req.body, {
    question: ["question", (v) => str(v, "question", 1000)],
    answer: ["answer", (v) => str(v, "answer", 10000)],
    keywords: ["keywords", keywords],
    enabled: ["enabled", (v) => bool(v, "enabled")],
    category: ["category_id", (v) => categoryId(pool, kb, str(v, "category", 100, false))],
    intent_id: ["intent_id", (v) => intentRef(v, kb)],
  }, true);
  res.json({ ok: true });
});

adminRouter.delete("/faqs/:id", async (req, res) => del("faqs", intParam(req), res));

// Documents

async function save(kbId: number, r: Extracted, category: string | null, sourceType: string, sourceName: string) {
  return tx(async (c) => {
    if (r.kind === "faqs") {
      for (const f of r.faqs) await insertFaq(c, { kbId, ...f, category: f.category ?? category });
      return { type: "faqs" as const, count: r.faqs.length };
    }
    const id = await insertDocument(c, { kbId, title: r.title.slice(0, 300), category, sourceType, sourceName, sections: r.sections });
    return { type: "document" as const, id, title: r.title, sections: r.sections.length };
  });
}

adminRouter.get("/kbs/:kb/documents", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.enabled, d.source_type, d.source_name, d.created_at, c.name AS category, d.intent_id, i.name AS intent,
            (SELECT count(*)::int FROM sections s WHERE s.document_id = d.id) AS section_count
       FROM documents d LEFT JOIN categories c ON c.id = d.category_id LEFT JOIN intents i ON i.id = d.intent_id
      WHERE d.kb_id = $1 ORDER BY d.id DESC`,
    [await kbFromParam(req)],
  );
  res.json(rows);
});

adminRouter.get("/documents/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.enabled, d.source_type, d.source_name, c.name AS category,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'heading', s.heading, 'body', s.body) ORDER BY s.position)
                        FROM sections s WHERE s.document_id = d.id), '[]') AS sections
       FROM documents d LEFT JOIN categories c ON c.id = d.category_id WHERE d.id = $1`,
    [intParam(req)],
  );
  if (!rows[0]) throw new HttpError(404, "not found");
  res.json(rows[0]);
});

// Manual document: either markdown `text` (split on headings) or explicit `sections`.
adminRouter.post("/kbs/:kb/documents", async (req, res) => {
  const kb = await kbFromParam(req);
  const b = req.body ?? {};
  const title = str(b.title, "title", 300)!;
  let sections;
  if (b.text != null) {
    sections = markdownToSections(str(b.text, "text", 500_000)!).sections;
  } else {
    if (!Array.isArray(b.sections) || b.sections.length === 0) throw bad("provide text, or sections as a non-empty array");
    sections = b.sections.map((s: any, i: number) => ({
      heading: str(s?.heading, `sections[${i}].heading`, 300, false) ?? "",
      body: str(s?.body, `sections[${i}].body`, 50_000)!,
    }));
  }
  if (sections.length === 0) throw bad("document has no text");
  res.status(201).json(await save(kb, { kind: "document", title, sections }, str(b.category, "category", 100, false), "manual", title));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

adminRouter.post("/kbs/:kb/upload", upload.single("file"), async (req, res) => {
  const kb = await kbFromParam(req);
  if (!req.file) throw bad("attach a file in the 'file' field");
  const category = str(req.body?.category, "category", 100, false);
  const name = req.file.originalname;
  res.status(201).json(await save(kb, await extract(req.file.buffer, name), category, "file", name));
});

adminRouter.post("/kbs/:kb/import-url", async (req, res) => {
  const kb = await kbFromParam(req);
  const raw = str(req.body?.url, "url", 2000)!;
  const category = str(req.body?.category, "category", 100, false);
  const { buf, contentType, url } = await fetchUrl(raw);
  res.status(201).json(await save(kb, await extractFetched(buf, contentType, url), category, "url", url.href));
});

adminRouter.patch("/documents/:id", async (req, res) => {
  const id = intParam(req);
  const kb = await kbOf("documents", id);
  await patchRow("documents", id, req.body, {
    title: ["title", (v) => str(v, "title", 300)],
    enabled: ["enabled", (v) => bool(v, "enabled")],
    category: ["category_id", (v) => categoryId(pool, kb, str(v, "category", 100, false))],
    intent_id: ["intent_id", (v) => intentRef(v, kb)],
  });
  res.json({ ok: true });
});

adminRouter.delete("/documents/:id", async (req, res) => del("documents", intParam(req), res));

adminRouter.patch("/sections/:id", async (req, res) => {
  await patchRow("sections", intParam(req), req.body, {
    heading: ["heading", (v) => str(v, "heading", 300, false) ?? ""],
    body: ["body", (v) => str(v, "body", 50_000)],
  });
  res.json({ ok: true });
});

adminRouter.delete("/sections/:id", async (req, res) => del("sections", intParam(req), res));

// ---------- errors ----------

// Analytics

adminRouter.get("/kbs/:kb/analytics", async (req, res) => {
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw bad("days must be an integer from 1 to 365");
  res.json(await report(await kbFromParam(req), days));
});

adminRouter.post("/kbs/:kb/analytics/reviewed", async (req, res) => {
  const key = str(req.body?.key, "key", 1000)!;
  res.json({ updated: await markReviewed(await kbFromParam(req), key) });
});

// Tickets (agent side)

adminRouter.get("/kbs/:kb/tickets", async (req, res) => {
  const status = req.query.status ?? "open";
  if (!["open", "closed", "all"].includes(status as string)) throw bad("status must be open, closed or all");
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.email, t.live, t.status, t.created_at, t.updated_at, m.body AS last_message, m.author AS last_author,
            (SELECT count(*)::int FROM ticket_messages x WHERE x.ticket_id = t.id) AS message_count
       FROM tickets t
       CROSS JOIN LATERAL (SELECT body, author FROM ticket_messages WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1) m
      WHERE t.kb_id = $1 AND ($2 = 'all' OR t.status = $2)
      ORDER BY t.updated_at DESC LIMIT 200`,
    [await kbFromParam(req), status],
  );
  res.json(rows);
});

adminRouter.get("/tickets/:id", async (req, res) => {
  const id = ticketId(req);
  const { rows: [t] } = await pool.query(
    "SELECT id, kb_id, conversation_id, name, email, live, status, created_at, updated_at FROM tickets WHERE id = $1", [id],
  );
  if (!t) throw new HttpError(404, "ticket not found");
  // What the visitor asked the bot before asking for a person (from the analytics log, so contact details are redacted).
  const { rows: conversation } = t.conversation_id
    ? await pool.query("SELECT message, level, created_at FROM questions WHERE conversation_id = $1 AND kb_id = $2 ORDER BY id", [t.conversation_id, t.kb_id])
    : { rows: [] };
  res.json({ ...t, messages: await messages(id), conversation });
});

adminRouter.post("/tickets/:id/messages", async (req, res) => {
  const id = ticketId(req);
  const body = str(req.body?.message, "message", 5000)!;
  // Replying reopens a closed ticket: the agent is continuing the conversation.
  const { rowCount } = await pool.query(
    `WITH t AS (UPDATE tickets SET updated_at = now(), status = 'open' WHERE id = $1 RETURNING id)
     INSERT INTO ticket_messages (ticket_id, author, body) SELECT id, 'agent', $2 FROM t`,
    [id, body],
  );
  if (!rowCount) throw new HttpError(404, "ticket not found");
  res.status(201).json({ messages: await messages(id) });
});

adminRouter.patch("/tickets/:id", async (req, res) => {
  const id = ticketId(req);
  const status = req.body?.status;
  if (status !== "open" && status !== "closed") throw bad("status must be open or closed");
  const { rowCount } = await pool.query("UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
  if (!rowCount) throw new HttpError(404, "ticket not found");
  res.json({ ok: true });
});

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "File is larger than 20 MB" : err.message });
  }
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "request body too large" });
  if (err?.code === "23505") return res.status(409).json({ error: "that name is already in use" });
  console.error(err);
  res.status(500).json({ error: "internal error" });
}

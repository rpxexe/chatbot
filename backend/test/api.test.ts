// Integration test: needs Postgres running and `npm run seed` done first.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

process.env.ADMIN_TOKEN ||= "test-admin-token";
const TOKEN = process.env.ADMIN_TOKEN;

const { app } = await import("../src/app.js");
const { pool, migrate } = await import("../src/db.js");
await migrate();

const server = app.listen(0);
const base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
const auth = { authorization: `Bearer ${TOKEN}` };

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = auth) =>
  fetch(base + path, {
    method,
    headers: body instanceof FormData ? headers : { "content-type": "application/json", ...headers },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
// preview: true keeps test questions out of the analytics log (the default KB is real data).
const chat = async (message: string, kb?: string) => (await req("POST", "/chat", { message, kb, preview: true }, {})).json();

// Each run works in its own throwaway knowledge base.
const slug = `test-${Date.now()}`;
let kb: number;
before(async () => {
  const r = await req("POST", "/admin/kbs", { name: "Test KB", slug });
  assert.equal(r.status, 201);
  kb = (await r.json()).id;
});
after(async () => {
  await req("DELETE", `/admin/kbs/${kb}`);
  server.close();
  await pool.end();
});

test("default KB: exact and paraphrased questions hit the right FAQ", async () => {
  assert.equal((await chat("What is your refund policy?")).source.question, "What is your refund policy?");
  assert.equal((await chat("how do I get my money back")).source.question, "What is your refund policy?");
  assert.equal((await chat("forgot my password")).source.question, "How do I reset my password?");
  assert.equal((await chat("do you deliver overseas")).source.question, "Do you ship internationally?");
});

test("default KB: document section beats weaker FAQ match", async () => {
  const r = await chat("how long do you keep my data");
  assert.equal(r.source.type, "document");
  assert.equal(r.source.heading, "Data retention");
});

test("unknown and stopword-only questions fall back", async () => {
  for (const m of ["what is the weather today", "the"]) {
    const r = await chat(m);
    assert.equal(r.found, false);
    assert.equal(r.source, null);
  }
});

test("calibration maps tuned score thresholds onto the confidence bands", async () => {
  const { calibrate } = await import("../src/search.js");
  assert.deepEqual([0, 0.3, 0.6, 1].map((s) => Math.round(calibrate(s) * 1000) / 1000), [0, 0.5, 0.8, 1]);
  assert.ok(calibrate(0.29) < 0.5 && calibrate(0.45) > 0.5 && calibrate(0.45) < 0.8);
});

test("confidence bands: answer, answer + clarification, fallback", async () => {
  const high = await chat("How do I reset my password?");
  assert.deepEqual([high.level, high.found, high.clarification], ["high", true, null]);
  assert.ok(high.confidence >= 0.8);

  const medium = await chat("do you deliver overseas");
  assert.deepEqual([medium.level, medium.found, medium.source.question], ["medium", true, "Do you ship internationally?"]);
  assert.match(medium.clarification, /Did you mean “Do you ship internationally\?”/);

  // Two entries score almost the same: never confident enough to answer outright.
  const tie = await chat("change password");
  assert.equal(tie.level, "medium");
  assert.ok(tie.results[1].score >= 0.9 * tie.results[0].score);

  const low = await chat("what is the capital of france");
  assert.deepEqual([low.level, low.found, low.source, low.answer], ["low", false, null, "I couldn't find an answer to that in our knowledge base."]);
  assert.ok(low.confidence < 0.5);
});

test("widget contract: CORS on /chat only, knowledgeBaseId, source.title", async () => {
  const pre = await fetch(`${base}/chat`, { method: "OPTIONS", headers: { origin: "https://shop.example", "access-control-request-method": "POST" } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
  assert.match(pre.headers.get("access-control-allow-headers")!, /content-type/);

  const r = await req("POST", "/chat", { knowledgeBaseId: "default", message: "How can I cancel?", preview: true }, { origin: "https://shop.example" });
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const body = await r.json();
  assert.equal(body.source.title, "How do I cancel my subscription?");
  assert.equal(typeof body.confidence, "number");
  assert.ok(body.conversationId);
  assert.equal((await req("POST", "/chat", { knowledgeBaseId: "nope-404", message: "hi" }, {})).status, 404);

  // The admin API stays same-origin only.
  assert.equal((await req("GET", `/admin/kbs`)).headers.get("access-control-allow-origin"), null);
});

test("chat returns entities and the order_status intent", async () => {
  const r = await chat("My order #ORD-92831 hasn't arrived.");
  assert.equal(r.intent.name, "order_status");
  assert.deepEqual(r.entities, { order_id: ["ORD-92831"] });
});

test("health checks the database, at /health and /api/health", async () => {
  for (const url of [`${base.replace(/\/api$/, "")}/health`, `${base}/health`]) {
    const r = await fetch(url);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual([body.ok, body.db], [true, "up"]);
  }
});

test("chat validates input and unknown KB", async () => {
  assert.equal((await req("POST", "/chat", {}, {})).status, 400);
  assert.equal((await req("POST", "/chat", { message: "x".repeat(501) }, {})).status, 400);
  assert.equal((await req("POST", "/chat", { message: "hi", kb: "nope-404" }, {})).status, 404);
});

test("admin endpoints require the token", async () => {
  assert.equal((await req("GET", "/admin/kbs", undefined, {})).status, 401);
  assert.equal((await req("GET", "/admin/kbs", undefined, { authorization: "Bearer wrong" })).status, 401);
  assert.equal((await req("GET", "/admin/kbs")).status, 200);
});

test("FAQ lifecycle: create, search, edit, disable, delete; KBs are isolated", async () => {
  assert.equal((await req("POST", `/admin/kbs/${kb}/faqs`, { question: "q" })).status, 400);
  const r = await req("POST", `/admin/kbs/${kb}/faqs`, {
    question: "Do you offer gift cards?", answer: "Yes, from $10 to $500.", category: "Billing", keywords: ["Gift Card", "voucher"],
  });
  assert.equal(r.status, 201);
  const { id } = await r.json();

  assert.equal((await chat("can I buy a voucher", slug)).source.id, id);
  assert.notEqual((await chat("can I buy a voucher")).source?.id, id, "must not leak into default KB");

  assert.equal((await req("PATCH", `/admin/faqs/${id}`, { answer: "Yes, any amount." })).status, 200);
  assert.equal((await chat("gift card", slug)).answer, "Yes, any amount.");

  assert.equal((await req("PATCH", `/admin/faqs/${id}`, { enabled: false })).status, 200);
  assert.equal((await chat("gift card", slug)).found, false);

  const list = await (await req("GET", `/admin/kbs/${kb}/faqs?category=Billing`)).json();
  assert.deepEqual(list.map((f: any) => [f.id, f.enabled, f.keywords]), [[id, false, ["gift card", "voucher"]]]);

  assert.equal((await req("DELETE", `/admin/faqs/${id}`)).status, 204);
  assert.equal((await req("DELETE", `/admin/faqs/${id}`)).status, 404);
});

test("uploads: markdown becomes searchable sections; CSV FAQs import", async () => {
  const fd = new FormData();
  fd.append("file", new Blob(["# Warranty\n\n## Coverage\nAll gadgets carry a two year warranty against defects.\n"]), "warranty.md");
  fd.append("category", "Legal");
  const up = await req("POST", `/admin/kbs/${kb}/upload`, fd);
  assert.equal(up.status, 201);
  const doc = await up.json();
  assert.deepEqual([doc.type, doc.title, doc.sections], ["document", "Warranty", 1]);

  const hit = await chat("how long is the warranty", slug);
  assert.equal(hit.source.type, "document");
  assert.equal(hit.source.documentId, doc.id);

  assert.equal((await req("PATCH", `/admin/documents/${doc.id}`, { enabled: false })).status, 200);
  assert.equal((await chat("how long is the warranty", slug)).found, false);

  const csv = new FormData();
  csv.append("file", new Blob(["question,answer,keywords\nWhere is my parcel?,Check the tracking link in your email.,tracking;parcel\n"]), "faqs.csv");
  const c = await req("POST", `/admin/kbs/${kb}/upload`, csv);
  assert.deepEqual(await c.json(), { type: "faqs", count: 1 });
  assert.equal((await chat("track my parcel", slug)).answer, "Check the tracking link in your email.");

  const badType = new FormData();
  badType.append("file", new Blob(["MZ"]), "virus.exe");
  assert.equal((await req("POST", `/admin/kbs/${kb}/upload`, badType)).status, 415);
});

test("manual document from text, section edit", async () => {
  const r = await req("POST", `/admin/kbs/${kb}/documents`, { title: "Hours", text: "## Opening hours\nWe are open Monday to Friday, 9am to 5pm." });
  const { id } = await r.json();
  const doc = await (await req("GET", `/admin/documents/${id}`)).json();
  assert.equal(doc.sections[0].heading, "Opening hours");
  await req("PATCH", `/admin/sections/${doc.sections[0].id}`, { body: "We are open every day, 8am to 8pm." });
  assert.match((await chat("opening hours", slug)).answer, /every day/);
});

test("a row matching most of the question beats one strong heading word", async () => {
  await req("POST", `/admin/kbs/${kb}/documents`, { title: "Remote", text: "## Remote work\nStaff may work remotely three days a week." });
  await req("POST", `/admin/kbs/${kb}/documents`, { title: "Loyalty", text: "Loyalty programme: members earn 5 points per dollar spent." });
  assert.match((await chat("how do loyalty points work", slug)).answer, /Loyalty programme/);
});

test("chat returns the ranked result list with signals", async () => {
  const r = await chat("How do I get my money back?");
  assert.equal(r.results[0].title, "What is your refund policy?");
  assert.equal(r.results[0].score, r.score);
  assert.deepEqual(Object.keys(r.results[0].signals).sort(), ["bm25", "fuzzy", "keyword", "phrase", "question"]);
  for (let i = 1; i < r.results.length; i++) assert.ok(r.results[i - 1].score >= r.results[i].score);
});

test("custom synonyms take effect immediately, and validate", async () => {
  await req("POST", `/admin/kbs/${kb}/faqs`, { question: "Is there a staff discount?", answer: "Staff get 20% off.", keywords: ["staff discount"] });
  assert.equal((await chat("do employees get a markdown", slug)).found, false);

  assert.equal((await req("POST", `/admin/kbs/${kb}/synonyms`, { terms: ["solo"] })).status, 400);
  const s = await req("POST", `/admin/kbs/${kb}/synonyms`, { terms: ["staff", "employees", "Employees "] });
  assert.equal(s.status, 201);
  const { id } = await s.json();
  await req("POST", `/admin/kbs/${kb}/synonyms`, { terms: ["discount", "markdown"] });

  const hit = await chat("do employees get a markdown", slug);
  assert.equal(hit.answer, "Staff get 20% off.");
  const list = await (await req("GET", `/admin/kbs/${kb}/synonyms`)).json();
  assert.deepEqual(list.custom.find((g: any) => g.id === id).terms, ["staff", "employees"]);
  assert.ok(list.builtin.length > 10);

  assert.equal((await req("DELETE", `/admin/synonyms/${id}`)).status, 204);
  assert.ok((await chat("do employees get a markdown", slug)).score < hit.score, "deleted group no longer contributes");
});

test("intents: defaults exist, small talk answers directly, specific questions still go to search", async () => {
  const intents = await (await req("GET", `/admin/kbs/${kb}/intents`)).json();
  assert.ok(["greeting", "pricing", "cancellation", "location"].every((n) => intents.some((i: any) => i.name === n)));

  const hi = await chat("hello", slug);
  assert.deepEqual([hi.via, hi.source.type, hi.source.name], ["intent", "intent", "greeting"]);

  const r = await chat("How much does it cost?");
  assert.equal(r.intent.name, "pricing");
  assert.ok(r.intent.matched.includes("how much"));
});

test("intents: tagged content is boosted and used as fallback; responses and validation", async () => {
  const intents = await (await req("GET", `/admin/kbs/${kb}/intents`)).json();
  const location = intents.find((i: any) => i.name === "location");

  // No shared words with "Where are you located?" — only the intent tag can find it.
  const f = await (await req("POST", `/admin/kbs/${kb}/faqs`, { question: "Visiting us", answer: "12 Harbour Street, Dublin.", intent_id: location.id })).json();
  let r = await chat("Where are you located?", slug);
  assert.deepEqual([r.found, r.via, r.answer], [true, "intent_fallback", "12 Harbour Street, Dublin."]);
  assert.ok(r.results[0].boost > 0);

  // A fixed response wins when the intent explains the question.
  assert.equal((await req("PATCH", `/admin/intents/${location.id}`, { response: "Find us at 12 Harbour Street." })).status, 200);
  r = await chat("Where are you located?", slug);
  assert.deepEqual([r.via, r.answer], ["intent", "Find us at 12 Harbour Street."]);

  // Disabled intents are ignored.
  await req("PATCH", `/admin/intents/${location.id}`, { enabled: false });
  assert.equal((await chat("Where are you located?", slug)).intent, null);

  // Validation.
  assert.equal((await req("POST", `/admin/kbs/${kb}/intents`, { name: "Bad Name!", patterns: ["x"] })).status, 400);
  assert.equal((await req("POST", `/admin/kbs/${kb}/intents`, { name: "empty", patterns: [] })).status, 400);
  assert.equal((await req("POST", `/admin/kbs/${kb}/intents`, { name: "pricing", patterns: ["x"] })).status, 409);
  const other = await (await req("GET", `/admin/kbs/1/intents`)).json();
  assert.equal((await req("PATCH", `/admin/faqs/${f.id}`, { intent_id: other[0].id })).status, 400, "cross-KB intent rejected");
  assert.equal((await req("PATCH", `/admin/faqs/${f.id}`, { intent_id: null })).status, 200);

  const created = await (await req("POST", `/admin/kbs/${kb}/intents`, { name: "parking", patterns: ["Parking", "car park", "parking"] })).json();
  const list = await (await req("GET", `/admin/kbs/${kb}/intents`)).json();
  assert.deepEqual(list.find((i: any) => i.id === created.id).patterns, ["parking", "car park"]);
  assert.equal((await req("DELETE", `/admin/intents/${created.id}`)).status, 204);
});

test("URL import blocks private and local addresses", async () => {
  for (const url of ["http://127.0.0.1:4000/health", "http://localhost/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "file:///etc/passwd"]) {
    const r = await req("POST", `/admin/kbs/${kb}/import-url`, { url });
    assert.equal(r.status, 400, url);
  }
});

test("conversation context: follow-ups reuse the previous topic; small talk and new topics behave", async () => {
  const say = async (message: string, conversationId?: string) =>
    (await req("POST", "/chat", { message, conversationId, preview: true }, {})).json();

  const first = await say("What is your refund policy?");
  assert.match(first.conversationId, /^[0-9a-f-]{36}$/);
  assert.equal(first.followUp, null);

  // Alone this matches the shipping FAQ; as a follow-up it stays on refunds.
  assert.equal((await say("What about international orders?")).source.question, "Do you ship internationally?");
  const follow = await say("What about international orders?", first.conversationId);
  assert.equal(follow.conversationId, first.conversationId);
  assert.equal(follow.source.question, "What is your refund policy?");
  assert.equal(follow.followUp.previousQuestion, "What is your refund policy?");

  // Small talk doesn't replace the topic; a clearly new question wins on its own score.
  assert.equal((await say("thanks", first.conversationId)).via, "intent");
  assert.equal((await say("what about digital products?", first.conversationId)).source.question, "What is your refund policy?");
  const fresh = await say("and how do I reset my password?", first.conversationId);
  assert.equal(fresh.source.question, "How do I reset my password?");
  assert.equal(fresh.followUp, null);

  // Bad or foreign ids start a new conversation instead of failing.
  assert.notEqual((await say("hi", "not-a-uuid")).conversationId, "not-a-uuid");
  const other = await (await req("POST", "/chat", { message: "hi", kb: slug, conversationId: first.conversationId }, {})).json();
  assert.notEqual(other.conversationId, first.conversationId, "a conversation is bound to its knowledge base");
});

test("analytics: counts, grouped unanswered questions, redaction, preview not logged, review", async () => {
  const ask = async (message: string, extra: object = {}) =>
    (await req("POST", "/chat", { message, kb: slug, ...extra }, {})).json();
  const analytics = async () => (await req("GET", `/admin/kbs/${kb}/analytics?days=7`)).json();
  const before = (await analytics()).totals.questions;

  const a = await ask("Do you deliver to Nepal?");
  await ask("do you deliver to  nepal", { conversationId: a.conversationId });
  await ask("Do you accept UPI? mail jo@example.com");
  await ask("Do you deliver to Nepal?", { preview: true });

  const r = await analytics();
  assert.equal(r.totals.questions, before + 3, "preview questions are not logged");
  assert.equal(r.totals.unanswered + r.totals.answered + r.totals.lowConfidence, r.totals.questions);
  const nepal = r.unanswered.find((u: any) => u.key === "do you deliver to nepal");
  assert.equal(nepal.count, 2, "repeats are grouped regardless of case and spacing");
  const upi = r.unanswered.find((u: any) => u.key.startsWith("do you accept upi"));
  assert.equal(upi.question, "Do you accept UPI? mail [email]");
  assert.ok(r.topics.some((t: any) => t.topic === "nepal"));
  assert.ok(!r.topics.some((t: any) => /example/.test(t.topic)), "contact details never become topics");

  const done = await (await req("POST", `/admin/kbs/${kb}/analytics/reviewed`, { key: nepal.key })).json();
  assert.equal(done.updated, 2);
  assert.ok(!(await analytics()).unanswered.some((u: any) => u.key === nepal.key));

  assert.equal((await req("GET", `/admin/kbs/${kb}/analytics?days=0`)).status, 400);
  assert.equal((await req("GET", `/admin/kbs/${kb}/analytics`, undefined, {})).status, 401);
});

test("handoff: channels offered when unanswered or requested; tickets and live threads", async () => {
  const ask = async (message: string) => (await req("POST", "/chat", { message, kb: slug, preview: true }, {})).json();
  assert.equal((await ask("what is the capital of france")).handoff, null, "no channels configured, no handoff");

  assert.equal((await req("PATCH", `/admin/kbs/${kb}`, { handoff: { email: "nope" } })).status, 400);
  assert.equal((await req("PATCH", `/admin/kbs/${kb}`, { handoff: { fax: "1" } })).status, 400);
  const settings = { email: "help@shop.example", contactUrl: "https://shop.example/contact", whatsapp: "+44 7700 900123", ticket: true, live: false };
  assert.equal((await req("PATCH", `/admin/kbs/${kb}`, { handoff: settings })).status, 200);

  const miss = await ask("what is the capital of france");
  assert.deepEqual(miss.handoff, {
    reason: "unanswered", question: "what is the capital of france",
    email: "help@shop.example", contactUrl: "https://shop.example/contact", whatsapp: "447700900123", ticket: true,
  });
  const human = await ask("can I talk to a real person");
  assert.equal(human.handoff.reason, "requested");
  assert.equal(human.answer, "Of course. You can reach our team using one of the options below.");
  assert.equal((await ask("hi")).handoff, null, "answered questions offer no handoff");

  // Tickets need an email; live chat is disabled here.
  const ticket = (body: object) => req("POST", "/tickets", { kb: slug, ...body }, { origin: "https://shop.example" });
  assert.equal((await ticket({ message: "Do you deliver to Nepal?" })).status, 400);
  assert.equal((await ticket({ message: "hello", live: true, })).status, 403);
  const created = await ticket({ message: "Do you deliver to Nepal?", email: "jo@example.com", name: "Jo", conversationId: miss.conversationId });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("access-control-allow-origin"), "*");
  const t = await created.json();
  assert.equal(t.messages.length, 1);

  const list = await (await req("GET", `/admin/kbs/${kb}/tickets`)).json();
  assert.ok(list.some((x: any) => x.id === t.id && x.last_message === "Do you deliver to Nepal?" && x.email === "jo@example.com"));
  assert.equal((await req("POST", `/admin/tickets/${t.id}/messages`, { message: "Yes, in 10 days." })).status, 201);

  const seen = await (await req("GET", `/tickets/${t.id}`, undefined, {})).json();
  assert.deepEqual(seen.messages.map((m: any) => m.author), ["visitor", "agent"]);
  assert.equal(seen.email, undefined, "the visitor endpoint never returns contact details");

  assert.equal((await req("PATCH", `/admin/tickets/${t.id}`, { status: "closed" })).status, 200);
  assert.equal((await req("POST", `/tickets/${t.id}/messages`, { message: "thanks" }, {})).status, 409);
  assert.equal((await req("GET", `/tickets/not-a-uuid`, undefined, {})).status, 404);
  assert.equal((await req("GET", `/admin/tickets/${t.id}`, undefined, {})).status, 401);
});

test("tenants: each sees and changes only its own chatbots", async () => {
  const run = Date.now();
  const a = { ...auth, "x-tenant-id": `test-tenant-a-${run}` };
  const b = { ...auth, "x-tenant-id": `test-tenant-b-${run}` };
  const r = await req("POST", "/admin/kbs", { name: "Tenant A bot" }, a);
  assert.equal(r.status, 201);
  const { id: kbA, slug: slugA } = await r.json();
  assert.match(slugA, /^tenant-a-bot-[0-9a-f]{6}$/, "generated slugs get a random suffix");
  try {
    const faq = await (await req("POST", `/admin/kbs/${kbA}/faqs`, { question: "What is the tenant secret?", answer: "Only A knows." }, a)).json();
    const doc = await (await req("POST", `/admin/kbs/${kbA}/documents`, { title: "A doc", text: "# Part\nA only text." }, a)).json();
    const section = (await (await req("GET", `/admin/documents/${doc.id}`, undefined, a)).json()).sections[0];
    const intent = (await (await req("GET", `/admin/kbs/${kbA}/intents`, undefined, a)).json())[0];

    assert.deepEqual(await (await req("GET", "/admin/kbs", undefined, b)).json(), []);
    assert.ok(!(await (await req("GET", "/admin/kbs")).json()).some((k: any) => k.id === kbA), "operator default tenant doesn't see it either");

    const attempts: [string, string, unknown?][] = [
      ["GET", `/admin/kbs/${kbA}/faqs`], ["GET", `/admin/kbs/${kbA}/analytics`], ["GET", `/admin/kbs/${kbA}/tickets`],
      ["POST", `/admin/kbs/${kbA}/faqs`, { question: "x", answer: "y" }],
      ["PATCH", `/admin/kbs/${kbA}`, { name: "taken" }], ["PATCH", `/admin/faqs/${faq.id}`, { answer: "changed" }],
      ["PATCH", `/admin/intents/${intent.id}`, { enabled: false }], ["PATCH", `/admin/sections/${section.id}`, { body: "changed" }],
      ["GET", `/admin/documents/${doc.id}`], ["GET", `/admin/documents/${doc.id}/file`],
      ["DELETE", `/admin/sections/${section.id}`], ["DELETE", `/admin/documents/${doc.id}`], ["DELETE", `/admin/faqs/${faq.id}`],
      ["DELETE", `/admin/kbs/${kbA}`],
    ];
    for (const [method, path, body] of attempts) assert.equal((await req(method, path, body, b)).status, 404, `${method} ${path}`);

    // Nothing changed, and visitors still reach the chatbot by its public slug.
    assert.equal((await chat("What is the tenant secret?", slugA)).answer, "Only A knows.");
    assert.equal((await (await req("GET", `/admin/documents/${doc.id}`, undefined, a)).json()).sections[0].body, "A only text.");
  } finally {
    assert.equal((await req("DELETE", `/admin/kbs/${kbA}`, undefined, a)).status, 204);
  }
});

test("websites: only listed sites and the app itself may use a chatbot from a browser", async () => {
  const set = (websites: unknown) => req("PATCH", `/admin/kbs/${kb}`, { websites });
  assert.equal((await set(["shop.example.com", "https://www.example.com/any/path", "shop.example.com"])).status, 200);
  const mine = (await (await req("GET", "/admin/kbs")).json()).find((k: any) => k.id === kb);
  assert.deepEqual(mine.websites, ["https://shop.example.com", "https://www.example.com"]);

  const from = (origin?: string) => req("POST", "/chat", { message: "hello", kb: slug, preview: true }, origin ? { origin } : {});
  assert.equal((await from("https://shop.example.com")).status, 200);
  assert.equal((await from("https://elsewhere.example")).status, 403);
  assert.equal((await from(new URL(process.env.APP_URL || "http://localhost:3000").origin)).status, 200);
  assert.equal((await from()).status, 200, "no Origin header: not a browser, not limited");

  assert.equal((await set(["ftp://files.example.com"])).status, 400);
  assert.equal((await set("example.com")).status, 400);
  assert.equal((await set([])).status, 200);
  assert.equal((await from("https://elsewhere.example")).status, 200, "an empty list allows every site");
});

test("uploads keep the original file in S3 storage", { skip: !process.env.S3_BUCKET && "S3_BUCKET not set" }, async () => {
  const content = "# Returns\n\nReturn anything within 30 days.\n";
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/markdown" }), "returns policy.md");
  const doc = await (await req("POST", `/admin/kbs/${kb}/upload`, fd)).json();
  assert.equal((await (await req("GET", `/admin/kbs/${kb}/documents`)).json()).find((d: any) => d.id === doc.id).has_file, true);

  const f = await req("GET", `/admin/documents/${doc.id}/file`);
  assert.equal(f.status, 200);
  assert.equal(await f.text(), content);
  assert.equal(f.headers.get("content-disposition"), "attachment; filename*=UTF-8''returns%20policy.md");

  const { rows: [{ file_key }] } = await pool.query("SELECT file_key FROM documents WHERE id = $1", [doc.id]);
  assert.ok(file_key.startsWith(`kb/${kb}/`));
  assert.equal((await req("DELETE", `/admin/documents/${doc.id}`)).status, 204);
  const { getFile } = await import("../src/storage.js");
  await assert.rejects(getFile(file_key), "deleting the document deletes the stored file");
});

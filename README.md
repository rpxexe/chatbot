# Footnote

Question → knowledge base → answer. No LLM, no embeddings, no AI APIs.
Matching uses PostgreSQL full-text search.

```
frontend/  Next.js: landing page at / (with the widget), widget page at /widget, admin dashboard at /admin (proxies /api to the backend)
backend/   Node.js + TypeScript + Express REST API
docker-compose.yml  PostgreSQL 17, S3-compatible storage (SeaweedFS), and the app images
```

## Run

```bash
docker compose up -d                                  # Postgres on :5432, S3 storage on :8333
cp backend/.env.example backend/.env                  # then set ADMIN_TOKEN (and the Clerk keys, see Phase 11)
cp frontend/.env.example frontend/.env.local          # optional: Clerk keys
cd backend  && npm i && npm run seed && npm run dev   # API on :4000
cd frontend && npm i && npm run dev                   # UI on :3000
```

- Landing page with a live demo: http://localhost:3000
- Chat: the widget on http://localhost:3000 (the `default` knowledge base). Full page: `/widget?kb=<slug>`.
- Admin: http://localhost:3000/admin. Sign in with Clerk when it is configured, else with `ADMIN_TOKEN`.

Everything in Docker: put `ADMIN_TOKEN` and the Clerk keys in a `.env` next to `docker-compose.yml`, then
`docker compose --profile app up -d --build`. Set `API_PORT` / `WEB_PORT` to publish on ports other than 4000 / 3000. The frontend image bakes in the Clerk publishable key, so rebuild it after changing that key.

The backend scripts load `backend/.env`. Variables already set in the shell take precedence.

`npm run seed` **wipes** all content in the `default` knowledge base and reloads `backend/src/seed-data.json`.
Other knowledge bases are left alone. Use it in development only, and check which database `DATABASE_URL` points to first.

| Variable | Where | Default |
|---|---|---|
| `DATABASE_URL` | backend | `postgres://chatbot:chatbot@localhost:5432/chatbot` |
| `PORT` | backend | `4000` |
| `ADMIN_TOKEN` | backend | none. Operator key, see Phase 11. Admin API returns 503 if neither this nor Clerk is set. |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | backend | none. Customer sign-in. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | frontend (publishable key read at build) | none. Empty = admin token sign-in. |
| `APP_URL` | backend | `http://localhost:3000`. The frontend's public URL. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | backend | none. Without `S3_BUCKET`, original uploads are not kept. |
| `API_URL` | frontend (read at build/dev start) | `http://localhost:4000` |

## Tests

```bash
cd backend && npm run seed && npm test
```

Unit tests cover the search engine, intent detection, the extractors and the address blocklist. Integration tests run against the database in `DATABASE_URL`.
They create a throwaway knowledge base and delete it afterwards.

## Admin dashboard (Phase 2)

- **Knowledge bases**: create, switch, delete. Each has its own FAQs, documents and categories, and a public slug for the chat.
- **FAQs**: add, edit, delete, enable/disable. Set a category and keywords. Search and filter by category.
- **Documents**: add from a file, a website URL or pasted text. View and edit the extracted sections. Enable/disable, recategorise, delete.
- **Categories**: created by typing a name on a FAQ or document. Rename or delete them in the Categories tab. Deleting a category leaves its content uncategorised.
- **Preview**: ask questions on the right-hand panel. It shows the answer, the source and the match score, exactly as visitors would see it.

Disabled FAQs and documents are kept, but chat never uses them.

### How content becomes searchable (`backend/src/extract.ts`)

Every format is reduced to markdown-like text, split on headings, then chunked into sections of at most 2,000 characters.

| Input | Conversion |
|---|---|
| PDF | Text per page (`unpdf`). Each page becomes sections headed "Page N". Scanned PDFs have no text layer and are rejected, because OCR is not supported. |
| DOCX | `mammoth` turns it into HTML. Word headings become section headings. |
| Markdown / TXT | Split on `#` headings. TXT without headings becomes paragraph chunks. |
| CSV | With `question` and `answer` columns (optional `category`, `keywords` separated by `;`), rows import as **FAQs**. Any other CSV becomes one section per row. |
| Website URL | Fetches the page and strips script, nav, header, footer and aside. Headings become sections. PDF and text URLs are handled by type. Pages rendered only by JavaScript come out empty. |
| Manual | FAQ form, or a document written as Markdown text. |

Limits: 20 MB per upload and 10 MB per fetched page.
URL import only fetches public `http(s)` addresses. Private, loopback and link-local addresses are refused, including after redirects.

## Data model

| Table | Purpose |
|---|---|
| `knowledge_bases` | one chatbot: name, unique public `slug`, `owner_id` (tenant), `websites` allowed to embed it, handoff settings |
| `categories` | per knowledge base, unique by name |
| `faqs` | question, answer, keywords[], category, enabled |
| `documents` | title, category, enabled, source type (`file` / `url` / `manual`), source name, and `file_key` of the original upload in storage |
| `sections` | searchable chunks of a document (heading + body) |
| `synonyms` | per-knowledge-base synonym groups (`terms text[]`) |
| `intents` | per knowledge base: `name`, `patterns text[]`, `response`, `enabled`. `faqs.intent_id` and `documents.intent_id` tag content. |
| `conversations` | chat context per conversation (uuid `id`, `kb_id`): previous question, answer, intent, matched article, entities. See Phase 5. |
| `schema_migrations` | applied migration versions |

`faqs.search` and `sections.search` are generated `tsvector` columns with GIN indexes.
Weights: FAQ question and keywords = A, answer = C. Section heading = A, body = B.

Migrations live in `backend/src/schema.ts` as an append-only list. They are applied on server start and by `npm run seed`.

## Search engine (Phase 3, `backend/src/engine/`)

The engine is deterministic: the same question and content always give the same ranking. It uses no ML and no external services.

**Query analysis**

1. Lowercase the question, strip accents and split it into words.
2. Drop stopwords and question filler such as "how do I", "can I get" and "please".
3. Porter-stem each word, so "refunds" becomes `refund` and "policies" becomes `polici`.
4. **Fuzzy correction:** a word the knowledge base doesn't know is matched to known words within 1 edit (2 edits for words of 7+ letters). Corrections count 0.85 × their similarity.
5. **Synonyms:** spans of 1–3 words are looked up in the synonym dictionary. "money back" becomes `refund`, `reimbursement` and so on. Synonyms count 0.7.

**Signals per entry, each 0–1**

| Signal | Weight | What it measures |
|---|---|---|
| BM25 | 0.35 | BM25F over boosted fields (question/heading ×3, keywords ×3, body ×1, document title ×0.5). Expressed as the idf-weighted share of the question that is covered. |
| Keyword | 0.20 | Share of the question matched by the entry's curated keywords. FAQs only. |
| Phrase | 0.10 | Longest run of consecutive question words found in the same order in the entry. Only for questions of 2+ words. |
| Question similarity | 0.20 | TF-IDF cosine between the question and the FAQ question, or the document title + section heading. |
| Fuzzy | 0.15 | Character-trigram similarity of the same two texts. Catches typos and reordered words. |

The score is the weighted sum of the signals that apply, rescaled to 0–1.
A word the knowledge base never uses counts at half weight: plain BM25 would ignore it, but an off-topic question should still score lower.

## Intent detection (Phase 4, `backend/src/engine/intents.ts`)

Intents are deterministic and defined per knowledge base in the admin **Intents** tab.
Each intent has a name, patterns, an optional fixed response and an enabled flag:

```json
{ "name": "pricing", "patterns": ["price", "pricing", "cost", "how much", "charges", "fee"], "response": null }
```

**Matching**

- Patterns match whole words, in order, after stemming. Stopwords are kept, so "how much" and "where are you" work.
- One-word patterns of 5+ letters also match a word one typo away ("pricng").

**Confidence** is the share of the question that the intent's matched patterns explain.
Content words count 1. Filler words count 0.2, unless a matched pattern contains them.

| Question | Intent | Confidence |
|---|---|---|
| "How much does it cost?" | pricing | 0.88 |
| "Can I cancel?" | cancellation | 0.71 |
| "Where are you located?" | location | 1.00 |
| "How much does it cost to ship to Canada?" | pricing | 0.52 (search decides) |

Ties are broken by more content words explained, then by longer pattern, then by name.

New knowledge bases start with 13 default intents: greeting, thanks, goodbye, human_agent, pricing, cancellation, refund, location, hours, contact, shipping, account and payment.
Only greeting, thanks and goodbye have fixed responses. Add one to `location` (your address) and to `hours`.

FAQs and documents can be **tagged** with one intent.

**How an answer is chosen** (`backend/src/search.ts`). The response's `via` field says which rule applied:

1. **`intent`**: the top intent has confidence ≥ 0.3 and a fixed response. Its response is used when the intent explains the question (confidence ≥ **0.6**), or when search finds nothing.
2. **`search`**: the best search result scores ≥ **0.3**.
   Entries tagged with the detected intent are always candidates and get a boost of up to 0.25 × confidence.
   A tag alone therefore never reaches 0.3; it needs at least some words in common.
3. **`intent_fallback`**: search found nothing above the threshold, but the top result is tagged with the detected intent. It is used even with weak word overlap.
4. **`none`**: the fallback message is returned with "Did you mean" suggestions.

Section answers are trimmed to the most relevant sentences.
Every response includes the detected `intents` and the ranked `results`: score, intent boost, per-signal breakdown and matched terms. The admin preview panel shows both.

**Synonyms.** Built-in groups are in `engine/synonyms.ts`. Each knowledge base adds its own groups in the admin **Synonyms** tab.

**Index and cache.** Each API process builds an in-memory index per knowledge base on first use.
Database triggers bump `knowledge_bases.content_version` on any change to FAQs, documents, sections, categories or synonyms. The next question then rebuilds the index, in every process.
This is sized for knowledge bases up to tens of thousands of sections.

The Postgres `tsvector` columns from Phase 1 are still in the schema but are no longer used for ranking.

Tuning knobs:
- `WEIGHTS`, `SYNONYM_WEIGHT`, `FUZZY_WEIGHT` and `UNSEEN_WEIGHT` in `engine/engine.ts`
- `MIN_SCORE` in `search.ts`
- `npm test` runs `test/engine.test.ts` with ranking assertions on the seed data. Re-run it after any change.

## Conversation context (Phase 5, `backend/src/context.ts`)

Follow-up questions are read against the previous question. No LLM is involved:

```
User: What is your refund policy?        → refund FAQ
User: What about international orders?   → searched as "refund policy What about international orders?" → refund FAQ
```

Without the conversation, the second question matches "Do you ship internationally?".

Each conversation is a row in `conversations`, bound to one knowledge base:
`previous_question`, `previous_answer`, `detected_intent`, `matched_article` (the answer's `source`) and `entities`.
`entities` are the topic words of the conversation so far: content words with stopwords removed, at most the last 8.

**How a follow-up is resolved**

1. The message is answered on its own, as before.
2. The topic words are prepended to the message, and this combined query is also answered when either of these holds:
   - the message reads like a follow-up: it opens with "what about", "how about", "and", "also", "same" or "what if", or it uses a pronoun ("it", "that", "they"…) and has at most 3 content words of its own;
   - the message alone found nothing.
3. The combined answer is used only if it scores higher than the message alone.
   So "what about internationally?" after a shipping-time question still gets "Do you ship internationally?".
4. A confident fixed intent response, such as "thanks", is never replaced.

Only answers from content update the context. Small talk and unanswered questions keep the previous topic.
A conversation expires after 30 minutes of inactivity. Expired rows are deleted when new conversations start.

## Website widget (Phase 8, `frontend/public/widget.js`)

Paste one line on any website:

```html
<script src="https://<your chatbot host>/widget.js" data-kb="default" async></script>
```

- `data-kb`: knowledge base slug (default `default`). Optional: `data-title` and `data-greeting`, which override the dashboard's Customize settings.
- The script only draws the chat button (in a shadow root, so the site's CSS cannot change it). The chat is the app's
  `/widget?kb=<slug>` page in an iframe, loaded on first hover or open. Opened directly, `/widget` is a full-page chat.
- Looks come from the dashboard's **Customize** tab (theme, colors, corner, icon, texts), read from the public
  `GET /api/widget/:slug` on every page load.
- Only the websites listed in the Install tab may frame `/widget` (`frame-ancestors`, set in `frontend/proxy.ts`).
- The conversation is kept in `sessionStorage`, so it survives page loads on the site until the tab closes.
- A reply that arrives while the panel is closed shows a badge on the button. Escape closes the panel.
- The host page can call `window.chatbotWidget.open()`, `.close()`, or `.destroy()` (single-page apps leaving the page).
- The landing page at `/` embeds it for the `default` chatbot, exactly like a customer site.

## Analytics (Phase 9, `backend/src/analytics.ts`, admin tab "Analytics")

Every visitor question is logged in `questions`, with its confidence band, intent, matched FAQ/document and topic words.
Questions from the admin preview (`preview: true`) are not logged. Emails and phone numbers are replaced with `[email]` / `[phone]` before storing.

- Totals for the last 7, 30 or 90 days: conversations, questions asked, answered (high confidence), low confidence (answered with a clarification), unanswered.
- **Questions the chatbot couldn't answer**, grouped by wording (case and spacing ignored), most asked first. **Add as FAQ** opens the FAQ form with the question filled in. **Dismiss** hides it. Both remove it from the list.
- Low-confidence questions, with the entry each one matched.
- Most searched topics (content words), most matched articles, popular intents.

## Human handoff (Phase 10, `backend/src/handoff.ts`, admin tab "Handoff")

When the bot can't answer (low confidence), or the visitor asks for a person (the `human_agent` intent), the chat response
carries `handoff` with the knowledge base's channels. The widget shows **Talk to a human** (or the options at once, if they asked).

| Channel | How it works |
|---|---|
| Contact form | Link to the URL you set |
| WhatsApp | `wa.me` link with the question prefilled |
| Get a reply by email | Ticket with the visitor's email (required). You reply in the Handoff tab; the reply is emailed to them. |
| Chat with an agent | Same ticket thread, email optional. Your replies appear in the visitor's widget, which polls every 5 seconds while open. |

Set the channels in the Handoff tab. With none set, no handoff is offered. The inbox refreshes every 5 seconds,
shows what the visitor asked the bot first, and lets you close or reopen a conversation.


## Multi-tenant platform (Phase 11)

```
Tenant (Clerk organization, or a Clerk user without one)
 └── Chatbot = knowledge base (public slug)
      ├── FAQs, documents (+ original files in S3), categories, intents, synonyms
      ├── Websites allowed to embed it
      ├── Conversations, analytics, handoff tickets
      └── Widget: <script src=".../widget.js" data-kb="<slug>">
```

**Sign-in.** With Clerk configured, customers sign up on `/admin`. The tenant is the Clerk organization they have active,
otherwise their own user, and everyone in an organization shares its chatbots. Switch organization with the switcher in the header.
To use organizations, turn them on in the Clerk dashboard.

**Operator.** `ADMIN_TOKEN` is the platform operator's key, for scripts, support and tests. It acts as tenant `admin`, which owns every
knowledge base created before Phase 11. With the header `X-Tenant-Id: <org_… or user_…>` it acts as that customer. Treat it like a root password.
To give the existing knowledge bases to a customer:
`UPDATE knowledge_bases SET owner_id = '<org_… or user_…>' WHERE owner_id = 'admin';`

**Isolation.** Every admin route resolves the knowledge base that owns the requested row and checks it belongs to the caller's tenant
(`kbOf` in `routes.ts`). Another tenant's ids answer 404, never 403, so they are not confirmed to exist. Search indexes, conversations
and analytics were already per knowledge base.

**Websites** (admin tab "Install"). The tab shows the embed snippet. When the list is not empty, `/api/chat` and `POST /api/tickets` refuse
browsers on other sites with 403. The app's own origin (`APP_URL`) is always allowed, for the widget page (/widget) and the preview.

**Storage.** With `S3_BUCKET` set, uploaded files (not CSV FAQ imports) are stored under `kb/<id>/` before the document row is written.
The Documents tab shows **Original** to download them. Deleting a document or knowledge base deletes its files.
`docker compose up -d` runs SeaweedFS as the S3 server for development. MinIO no longer publishes Docker images.
In production, use any S3-compatible store: AWS S3, Cloudflare R2, or Backblaze B2.

Public:

| Method | Path | Body |
|---|---|---|
| POST | `/api/chat` | `{ message, knowledgeBaseId?: slug, conversationId?, preview? }` (`kb` is accepted for `knowledgeBaseId`; default `default`). Returns `{ found, answer, score, confidence, level, clarification, source, via, intent, intents[], entities, related[], results[], conversationId, followUp }`. `source.type` is `faq`, `document` or `intent`, and every source has a `title`. CORS is open (`*`) on this endpoint only, for the website widget. Each result has `{ type, id, title, category, score, boost, signals, matched }`. Send `conversationId` back on the next question. An unknown, expired or malformed id starts a new conversation. `followUp` is `{ previousQuestion, query }` when the previous topic was used, else `null`. |

| POST | `/api/tickets` | `{ knowledgeBaseId, message, email?, name?, live?, conversationId? }`. `email` is required unless `live`. Returns `{ id, live, status, messages[] }`. 403 when that channel is off. |
| GET | `/api/tickets/:id` | `{ id, live, status, messages[] }`. The random ticket id is the visitor's only key. |
| GET | `/api/widget/:slug` | `{ websites, appearance }`: the widget's allowed sites and Customize settings, read by `widget.js` and `frontend/proxy.ts`. CORS open. |
| POST | `/api/tickets/:id/messages` | `{ message }`. 409 once the ticket is closed. |

The chat response also has `handoff`: `null`, or `{ reason: "unanswered" | "requested", question, ...channels }`.
CORS is open on `/api/chat`, `/api/tickets*` and `/api/widget/:slug` only.

Admin. Every call needs `Authorization: Bearer <Clerk session token>`, or `Bearer <ADMIN_TOKEN>` with an optional `X-Tenant-Id`.
Every call only sees the caller's tenant. Ids from another tenant return 404.

| Method | Path | Body / query |
|---|---|---|
| GET, POST | `/api/admin/kbs` | POST `{ name, slug? }`. Without `slug`, one is made from the name plus a random suffix. Slugs are unique across all tenants (409 if taken). |
| PATCH, DELETE | `/api/admin/kbs/:id` | PATCH `{ name?, handoff?, websites?, appearance? }`. `appearance` replaces the Customize settings (see `backend/src/appearance.ts`). `handoff` is `{ email?, contactUrl?, whatsapp?, ticket?, live? }`. `websites` is a list of sites like `"shop.example.com"` (stored as origins, max 50). DELETE removes all of the knowledge base's content and stored files. |
| GET | `/api/admin/kbs/:kb/categories` | |
| GET, POST | `/api/admin/kbs/:kb/synonyms` | GET returns `{ custom: [{ id, terms }], builtin }`. POST `{ terms: string[] }` (2–30 terms) |
| PATCH, DELETE | `/api/admin/synonyms/:id` | PATCH `{ terms }` |
| GET, POST | `/api/admin/kbs/:kb/intents` | POST `{ name, patterns: string[], response?, enabled? }`. `name` uses a-z, 0-9, `_` and `-`. |
| PATCH, DELETE | `/api/admin/intents/:id` | PATCH takes any subset of the POST fields. DELETE clears the tag from FAQs and documents. |
| PATCH, DELETE | `/api/admin/categories/:id` | PATCH `{ name }` |
| GET, POST | `/api/admin/kbs/:kb/faqs` | GET `?q=&category=`. POST `{ question, answer, category?, keywords?, enabled? }` |
| PATCH, DELETE | `/api/admin/faqs/:id` | PATCH takes any subset of the POST fields, plus `intent_id` (or `null`) |
| GET, POST | `/api/admin/kbs/:kb/documents` | POST `{ title, category?, text }` (Markdown) or `{ title, category?, sections: [{ heading?, body }] }` |
| POST | `/api/admin/kbs/:kb/upload` | multipart: `file`, optional `category` |
| POST | `/api/admin/kbs/:kb/import-url` | `{ url, category? }` |
| GET, PATCH, DELETE | `/api/admin/documents/:id` | GET includes sections. PATCH `{ title?, category?, enabled?, intent_id? }` |
| GET | `/api/admin/documents/:id/file` | The original upload, as a download. 404 when none is stored. |
| PATCH, DELETE | `/api/admin/sections/:id` | PATCH `{ heading?, body? }` |
| GET | `/api/admin/kbs/:kb/tickets` | `?status=open` (default), `closed` or `all` |
| GET | `/api/admin/tickets/:id` | Ticket, messages, and the visitor's earlier questions to the bot |
| POST | `/api/admin/tickets/:id/messages` | `{ message }`. Agent reply; reopens a closed ticket. |
| PATCH | `/api/admin/tickets/:id` | `{ status: "open" \| "closed" }` |
| GET | `/api/admin/kbs/:kb/analytics` | `?days=` 1–365 (default 30). Returns `{ days, totals, topics[], articles[], intents[], unanswered[], lowConfidence[] }`. |
| POST | `/api/admin/kbs/:kb/analytics/reviewed` | `{ key }` (a `question_key` from the report). Hides that question from both lists. |

Upload and URL import return `{ type: "document", id, title, sections }`, or `{ type: "faqs", count }` for a FAQ CSV.

## Known limits

- Follow-ups are resolved by adding words, not by understanding them. "How long does it take?" after a refund question still matches the shipping FAQ, because that scores higher on its own.
- No audit log, and no roles inside a Clerk organization: every member can change and delete everything.
- In token mode (no Clerk), the token is kept in the browser's `sessionStorage` until the tab closes or you sign out.
- Websites stop other sites from embedding a chatbot in a browser. They are not access control: a script can still call `/api/chat` with any slug.
- URL imports keep only the extracted text, not the fetched page. Deleting a stored file is best effort: a storage error leaves an orphaned object, logged by the backend.
- No billing or plan limits per tenant.
- No OCR, so scanned PDFs are rejected. Pages that need JavaScript to render are not supported.
- Re-importing a file or URL adds a new document. It does not replace the old one.
- The question log is kept forever. There is no retention limit or export yet.
- No rate limiting on the public endpoints (`/api/chat`, `/api/tickets`). Put the API behind a proxy that limits by IP before going live.
- The server sends no email. Ticket replies reach a visitor who left only through **Reply by email** from your own mail client.
- English only: the stemmer, stopwords and built-in synonyms are English.
- The 0.3 answer threshold and the signal weights were tuned on the small seed set. Check them with the preview panel once real content is loaded.

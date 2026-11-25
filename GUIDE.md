# Footnote guide

Footnote is a help chatbot for websites. It answers visitors from your own FAQs and documents, and every answer
names the article it came from. It uses no AI model: matching is deterministic search, so it only ever says what
your content says. When it can't answer, it says so and hands the visitor to a person.

This guide covers how to run the project, how to use every part of the app, and how the project is put together.
For the full technical reference (search engine, data model, every API route), see [README.md](README.md).

**Contents**

1. [What's in the project](#1-whats-in-the-project)
2. [Run it locally](#2-run-it-locally)
3. [Sign in to the dashboard](#3-sign-in-to-the-dashboard)
4. [Set up a chatbot, step by step](#4-set-up-a-chatbot-step-by-step)
5. [Every dashboard tab](#5-every-dashboard-tab)
6. [Put the chatbot on a website](#6-put-the-chatbot-on-a-website)
7. [What visitors see](#7-what-visitors-see)
8. [How answers are chosen](#8-how-answers-are-chosen)
9. [Where data is stored](#9-where-data-is-stored)
10. [Tests](#10-tests)
11. [Deploy](#11-deploy)
12. [Troubleshooting](#12-troubleshooting)
13. [Known limits](#13-known-limits)

---

## 1. What's in the project

| Part | Technology | What it does |
|---|---|---|
| `frontend/` | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui (incl. AI Elements) | Landing page, dashboard, the widget page, and `widget.js` |
| `backend/` | Node.js, TypeScript, Express | REST API, search engine, intents, analytics, tickets |
| Database | PostgreSQL 17 | All content, settings, conversations, analytics, tickets |
| File storage | Any S3-compatible store (SeaweedFS in development) | Original uploaded files (optional) |
| Sign-in | Clerk (optional) | Customer accounts and organizations. Without it, an operator token is used. |

**Pages**

| URL | What it is |
|---|---|
| `/` | Landing page. It embeds the real widget for the `default` chatbot. |
| `/admin` | Dashboard: content, settings, analytics, handoff inbox |
| `/widget?kb=<slug>` | The chat itself. Customer sites show it in a frame; opened directly, it is a full-page chat. |
| `/widget.js` | The embed script customers paste on their sites |
| Anything else | Custom 404 page |

**Folder map**

```
backend/src/
  routes.ts        API routes (public and admin)
  search.ts        Chooses the answer: intents, search, confidence, follow-ups
  engine/          Search index, intents, entities, synonyms
  context.ts       Follow-up questions read against the previous one
  handoff.ts       Talk-to-a-person channels
  analytics.ts     Question log and reports
  appearance.ts    Widget Customize settings (validation)
  extract.ts       PDF, Word, Markdown, CSV and web page import
  storage.ts       Original files in S3
  schema.ts        Database migrations (applied on start)
  seed-data.json   Demo content for the "default" chatbot
frontend/
  app/(site)/      Landing page and dashboard (the only pages that use Clerk)
  app/(site)/admin/  One file per dashboard tab
  app/widget/      The widget page
  components/chat.tsx  The chat used by the widget and the landing demo
  public/widget.js The embed script
  proxy.ts         Clerk session, and the widget's allowed-websites header
```

---

## 2. Run it locally

You need Node.js 22.9 or newer (the backend scripts use `--env-file-if-exists`) and Docker.

1. Start Postgres and the file storage:
   ```bash
   docker compose up -d
   ```
   Postgres listens on port 5432, the S3 storage on 8333.
2. Create the backend settings and set an operator token:
   ```bash
   cp backend/.env.example backend/.env
   ```
   Put a long random string in `ADMIN_TOKEN`, for example from
   `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`.
3. Optional: create the frontend settings, only if you use Clerk:
   ```bash
   cp frontend/.env.example frontend/.env.local
   ```
4. Install, load the demo content, and start the API (port 4000):
   ```bash
   cd backend && npm i && npm run seed && npm run dev
   ```
5. In a second terminal, start the web app (port 3000):
   ```bash
   cd frontend && npm i && npm run dev
   ```
6. Open http://localhost:3000 for the landing page and http://localhost:3000/admin for the dashboard.

> **Warning:** `npm run seed` deletes everything in the `default` chatbot (FAQs, documents, categories) and reloads
> `backend/src/seed-data.json`. Other chatbots are not touched. Check which database `DATABASE_URL` points to first.

**Settings**

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | backend | Postgres connection. Default `postgres://chatbot:chatbot@localhost:5432/chatbot` |
| `PORT` | backend | API port, default 4000 |
| `ADMIN_TOKEN` | backend | Operator key. Signs in to the dashboard when Clerk is off. Treat it like a root password. |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | backend | Customer sign-in |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | frontend | Customer sign-in. Leave empty to use `ADMIN_TOKEN`. |
| `APP_URL` | backend | The frontend's public address. Default `http://localhost:3000` |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | backend | Where original uploads are kept. Leave `S3_BUCKET` empty to keep only the extracted text. |
| `API_URL` | frontend | Backend address. Default `http://localhost:4000` |

`npm run dev` is slower than production because pages compile on first visit. Judge speed with
`npm run build && npm start` in `frontend`.

---

## 3. Sign in to the dashboard

Go to `/admin`.

- **With Clerk configured:** sign up or sign in. Your workspace is your active Clerk organization, or your own user if
  you have none. Everyone in an organization shares its chatbots. Turn organizations on in the Clerk dashboard to use them.
- **Without Clerk:** paste the `ADMIN_TOKEN` from `backend/.env`. The token is kept until the browser tab closes or you
  sign out.

The landing page header shows **Log in** / **Dashboard** and a sign-out button when you are signed in.

---

## 4. Set up a chatbot, step by step

The dashboard's **Setup guide** tab walks through these steps and ticks them off as you go.

1. **Create a chatbot.** Open the switcher at the top of the sidebar and choose **New chatbot**. Give it a name. It gets
   a public *slug* (its id in the embed code). One account can run several chatbots, each with its own content.
2. **Add what it may answer from.**
   - **FAQs** tab: write questions in your customers' words, with the answer. Add keywords for other ways people ask.
   - **Documents** tab: upload PDF, Word, Markdown, plain text, or a CSV of FAQs; import a web page by URL; or paste text.
     The chatbot never answers from anything else.
3. **Test it like a visitor.** Use **Test** in the header (or the panel beside the FAQs and Documents tabs on wide
   screens). Ask real questions, including vague and misspelled ones. Each answer shows its source and match score.
   If the wrong answer wins, reword the FAQ question or add keywords. Test questions are not counted in analytics.
4. **Teach it your visitors' words** (optional).
   - **Synonyms**: link words visitors use to yours, like "money back" and "refund".
   - **Intents**: catch what someone wants, like asking for a person, and optionally reply with fixed text.
5. **Choose how visitors reach a person.** In **Handoff**, set any of: email, a contact form link, WhatsApp, "Leave a
   message" (a ticket answered by email) or "Chat with an agent" (live replies in the widget). To try it, choose
   **Open chat in new tab** in the chatbot switcher, type "talk to a person" and pick one of the two. The conversation
   then appears in the Handoff inbox. The **Test** panel only lists the channels; it cannot start a conversation.
6. **Make it look like your site.** In **Customize**, set the theme, colors, button corner and icon, greeting and
   starter questions. See [Customize](#customize).
7. **Put it on your website.** In **Install**, copy the one-line embed code and list your website addresses.
   See [section 6](#6-put-the-chatbot-on-a-website).
8. **Check what visitors ask.** **Analytics** lists the questions the chatbot couldn't answer. Turn each into an FAQ in
   one click, and the next visitor gets an answer.

---

## 5. Every dashboard tab

The sidebar groups the tabs. Collapse it with the button at the top left of the header. On phones it opens as a sheet.
The open tab is kept in the address (for example `/admin#handoff`), so a reload or a shared link opens the same tab.

### Setup guide
The steps above, with links to each tab. A new, empty chatbot opens here.

### FAQs
- Add, edit, delete, and switch FAQs on or off. Switched-off FAQs are kept but never used in answers.
- Each FAQ has a question, an answer, an optional category, keywords and an intent tag.
- Search and filter by category.

### Documents
- **Upload a file:** PDF, DOCX, Markdown, TXT, or CSV, up to 20 MB.
  - PDFs become one section per page. Scanned PDFs (no text layer) are rejected: there is no OCR.
  - Word headings become sections.
  - A CSV with `question` and `answer` columns (optional `category`, and `keywords` separated by `;`) imports as FAQs.
- **Import a URL:** the page's text is fetched once. Pages that need JavaScript to show their content come out empty.
  Only public addresses are allowed.
- **Write text:** a document written as Markdown.
- Open a document to read and edit its sections. **Original** downloads the uploaded file when storage is on.
- Importing the same file again adds a new document; it does not replace the old one.

### Categories
Created by typing a name on an FAQ or document. Rename or delete them here. Deleting a category leaves its content
uncategorized. Categories also decide the follow-up suggestions (see [section 8](#8-how-answers-are-chosen)).

### Intents
What visitors are trying to do, matched by word patterns. New chatbots start with 13: greeting, thanks, goodbye,
human_agent, pricing, cancellation, refund, location, hours, contact, shipping, account and payment. Only greeting,
thanks and goodbye have fixed replies. Add replies to `location` and `hours` with your own details. Tag FAQs or documents
with an intent to boost them when that intent is detected.

### Synonyms
Your own groups of words that mean the same. Built-in groups are listed too.

### Analytics
For the last 7, 30 or 90 days:
- Totals: conversations, questions, answered, low confidence, unanswered.
- **Questions it couldn't answer**, grouped by wording. **Add as FAQ** opens the FAQ form prefilled. **Dismiss** hides it.
- Low-confidence questions, most searched topics, most matched articles, popular intents.
Emails and phone numbers in questions are replaced with `[email]` / `[phone]` before they are stored.

### Handoff
- **Settings:** the channels offered when the bot can't answer or someone asks for a person.
- **Inbox:** tickets and live chats, refreshed every 5 seconds. Each shows what the visitor asked the bot first.
  Reply in the thread, use **Reply by email**, and close or reopen conversations.
- The inbox stays empty until a visitor picks **Chat with an agent** or **Get a reply by email** in the real chat. Those two
  switches must be on. Email, WhatsApp and contact form links go outside the app and never show here.
- **Bell (top right of the dashboard):** open conversations waiting for your reply, with a count of the ones you
  haven't looked at. A toast pops up when a visitor writes; **Open** jumps to that conversation. Checked every 10
  seconds while the dashboard is open, for the selected chatbot only.
- **Replying by email:** under the reply box, **Also email to …** sends your reply to the visitor as an email too. It
  is on by default for "Get a reply by email" tickets and off for live chats. Emailed replies are marked "emailed" in the
  thread.
- **Email replies in the thread:** with `RESEND_INBOUND_DOMAIN` and `RESEND_WEBHOOK_SECRET` set (see
  `backend/.env.example`), a visitor who answers your email lands back in the same thread, marked "by email". Only
  replies from the ticket's own email address are accepted, and the quoted earlier email is cut off.
- **Emails** (when `RESEND_API_KEY` is set in `backend/.env`): each new ticket or live chat is emailed to the Handoff
  email, with the visitor as reply-to. Agent replies to "Get a reply by email" tickets are emailed to the visitor.
  `RESEND_FROM` must be on a domain verified in Resend; the default `onboarding@resend.dev` only delivers to your own
  Resend account's address.

### Customize
How the widget looks and behaves on your site. Three tabs, with a live preview on the right. On screens narrower than
1280px the preview moves below the settings.

| Tab | Setting | Notes |
|---|---|---|
| Style | Theme | Auto (follows the visitor's system), Light or Dark |
| Style | Accent color | Chat button, send button and the line beside quoted answers. Six presets or any color. |
| Style | Chat colors | Background, text, and the visitor's message bubble. "Theme" follows light/dark. |
| Button | Position | Top left, top right, bottom left, bottom right (hover an arrow to see its name) |
| Button | Icon | Six chat button icons |
| Button | Intro | On a visitor's first page, the button arrives as a pill reading "Ask <name>" (or your own text, up to 40 characters), then folds into the icon. Once per visitor session. |
| Button | Badge color | The count shown on the button when a reply arrives while the chat is closed |
| Content | Header title | Shown in the chat header and in "Ask <title>". Default "Footnote". |
| Content | Show sources | Name the article each answer came from |
| Content | Greeting | The first message visitors see |
| Content | Starter questions | Up to 4, one per line, 120 characters each. Shown as buttons under the greeting. |

- **Preview:** a mock page with the real widget. **Play intro** plays the button intro; **Show badge** shows an unread badge.
  Questions asked in the preview are not counted in analytics.
- **Save** makes the changes live on your site on its next page load. **Reset all** returns the form and preview to the
  defaults; press Save to apply.

### Install
- The embed code for this chatbot, with a **Copy** button.
- **Websites:** the sites allowed to show this chatbot, one per line (e.g. `shop.example.com`). List `www.` and bare
  domains separately. Leave empty to allow any site.

### Chatbot switcher (top of the sidebar)
Switch chatbots, create a new one, **Open chat in new tab** (the full-page chat), or delete the chatbot with all its
content and files.

---

## 6. Put the chatbot on a website

Paste this before `</body>` on every page that should show the chat button (the Install tab has it with your slug and
host filled in):

```html
<script src="https://<your Footnote host>/widget.js" data-kb="<your chatbot slug>" async></script>
```

Optional attributes, which override the Customize tab:

- `data-title`: header title and the "Ask …" intro text
- `data-greeting`: first message

**Open the chat from your own buttons:**

```js
window.chatbotWidget.open();    // open the chat
window.chatbotWidget.close();   // close it
window.chatbotWidget.destroy(); // remove the widget (single-page apps leaving the page)
```

`window.chatbotWidget` exists once `widget.js` has loaded.

**Allowed websites:** when the Install tab lists websites, browsers refuse to show the chat on any other site (the
widget page sends a `frame-ancestors` header). This stops other sites from embedding your chatbot. It is not access
control: scripts can still call the public API with your slug.

---

## 7. What visitors see

- **The button.** It appears once its look has loaded, in your corner and color. On the first page of a visit it
  plays the intro.
- **Opening.** The chat panel grows out of the button's corner, and the icon turns into a close cross. While the chat
  loads for the first time, the panel shows its outline. The chat starts loading in the background once the page is
  idle, or when the visitor hovers the button.
- **The chat.** The greeting and starter questions. Answers quoted from your content carry a green line and name the
  article ("From …"), with a copy button. Low-confidence answers ask "Did you mean …?". Answers offer up to 3
  follow-up questions. The input bar glows while an answer loads.
- **Reaching a person.** When the bot can't answer, or the visitor asks for a person, it offers your handoff channels.
  In a live chat, your replies appear in the widget, checked every 5 seconds.
- **Closing.** The close cross, the button, or Escape. If a reply arrives while the chat is closed, the button shakes
  and shows a badge with the count.
- **Across pages.** The conversation and whether the chat was open are kept until the browser tab closes.
- **Accessibility.** Keyboard and screen-reader friendly. Visitors who turn on "reduce motion" in their system get no
  animations.

---

## 8. How answers are chosen

No AI model is involved; the same question always gets the same answer.

1. **Intents.** If the question clearly matches an intent with a fixed reply (like "thanks"), that reply is used.
2. **Search.** Otherwise the question is matched against all FAQs and document sections, using words, stems, synonyms,
   typo correction and keywords. Entries tagged with the detected intent get a boost.
3. **Confidence.** The best match's score decides the reply:
   - **High:** the answer.
   - **Medium:** the answer, plus "I'm not completely sure … Did you mean …?". Also used when two different entries
     score almost the same.
   - **Low:** "I couldn't find an answer", with suggestions and the handoff channels.
4. **Follow-ups.** Up to 3 related questions: other FAQs worded like the question. For confident answers, the rest are
   filled from the answer's category. FAQs asked the same way as the answer are never offered back.
5. **Conversation context.** A follow-up like "what about international orders?" is read against the previous
   question, for 30 minutes.

Details and tuning knobs are in [README.md](README.md#search-engine-phase-3-backendsrcengine).

---

## 9. Where data is stored

| Data | Where |
|---|---|
| Chatbots, settings (handoff, websites, Customize) | Postgres `knowledge_bases` |
| FAQs, categories, intents, synonyms | Postgres |
| Uploaded documents: extracted text | Postgres `documents` and `sections`. The chatbot answers only from these. |
| Uploaded documents: the original file | S3 storage under `kb/<chatbot id>/…`, only when `S3_BUCKET` is set |
| Conversations (for follow-ups) | Postgres `conversations`, expire after 30 minutes |
| Visitor questions (analytics) | Postgres `questions`, kept with emails and phones masked |
| Tickets and live chats | Postgres `tickets` and `ticket_messages` |
| A visitor's chat in progress | The visitor's browser (`sessionStorage`), until the tab closes |

Deleting a document deletes its stored file. Deleting a chatbot deletes all its content and files.

---

## 10. Tests

```bash
cd backend && npm run seed && npm test
```

- Unit tests: search engine, intents, extractors, address blocklist.
- Integration tests run against the database in `DATABASE_URL`, in a throwaway chatbot they delete afterwards.
- Some tests expect the `default` chatbot to match `seed-data.json`, and the upload tests need the S3 storage from
  `docker compose up -d`.

Frontend checks: `cd frontend && npx tsc --noEmit && npm run build`.

---

## 11. Deploy

**Everything in Docker:** put `ADMIN_TOKEN` and the Clerk keys in a `.env` next to `docker-compose.yml`, then

```bash
docker compose --profile app up -d --build
```

Set `API_PORT` / `WEB_PORT` to use ports other than 4000 / 3000. The frontend image bakes in the Clerk publishable key,
so rebuild it after changing that key.

**Before going live:**
- Set `APP_URL` to the frontend's public address, and `API_URL` in the frontend to the backend's.
- Use a real S3 store (AWS S3, Cloudflare R2, Backblaze B2) or leave `S3_BUCKET` empty.
- Put the API behind a proxy that rate-limits `/api/chat` and `/api/tickets` by IP. The app has no rate limiting.
- The repository deploys the frontend to Vercel on pull requests (preview deployments).

---

## 12. Troubleshooting

| Problem | Cause and fix |
|---|---|
| Dashboard says sign-in is not configured | Set `ADMIN_TOKEN`, or both Clerk keys, in `backend/.env`, and restart the API. |
| Uploads fail | `S3_BUCKET` is set but the storage isn't running. Run `docker compose up -d`, or empty `S3_BUCKET`. |
| A PDF is rejected | It is scanned (no text layer). There is no OCR. |
| The widget doesn't appear on a site | The site isn't in the Install tab's website list, or the embed code's `data-kb` slug is wrong. |
| Customize changes don't show on the site | Press Save, then reload the site. Changes apply on the next page load. |
| The Customize preview is below the settings | The browser window is narrower than 1280px (display scaling or zoom count). Maximize or zoom out. |
| No follow-up questions after an answer | No other FAQ is similar and the answer has no category with other FAQs. Add a category or related FAQs. |
| The chat is slow to open in development | `npm run dev` compiles on first visit. Production is much faster. |
| My hand-added FAQs disappeared from `default` | `npm run seed` was run. It reloads the `default` chatbot from `seed-data.json`. |

---

## 13. Known limits

- English only: stemming, stopwords and built-in synonyms are English.
- No OCR, and no pages that need JavaScript to render.
- No rate limiting, billing or plan limits. No roles inside an organization: every member can change everything.
- The server sends no email. Ticket replies reach visitors through **Reply by email** from your own mail client.
- The question log is kept forever, with no export yet.
- Re-importing a file or URL adds a new document instead of replacing the old one.

The full list is in [README.md](README.md#known-limits).

/*
 * Website chat widget. Paste on any page:
 *
 *   <script src="https://<chatbot host>/widget.js" data-kb="<knowledge base slug>" async></script>
 *
 * Optional: data-title (header text, default "Chat"), data-greeting (first message).
 * Talks to POST /api/chat on the host it was loaded from, and to /api/tickets when the visitor asks for a person
 * (agent replies are polled every few seconds while the panel is open). Rendered in a shadow root so the page's CSS cannot reach it,
 * and all server text is inserted as text, never HTML.
 */
(() => {
  "use strict";
  if (window.__chatbotWidget) return;
  window.__chatbotWidget = true;

  const script = document.currentScript || document.querySelector('script[src*="/widget.js"]');
  if (!script) return;
  const api = new URL("/api/chat", script.src).href;
  const ticketsApi = new URL("/api/tickets", script.src).href;
  const POLL_MS = 5000;
  const kb = script.getAttribute("data-kb") || "default";
  const title = script.getAttribute("data-title") || "Chat";
  const greeting = script.getAttribute("data-greeting") || "Hello! How can I help you today?";
  const storeKey = `chatbot-widget:${kb}`;
  const MAX_STORED = 50;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #2563eb; --accent-fg: #fff; --bg: #fff; --fg: #111827; --muted: #4b5563; --border: #e5e7eb; --bot: #f3f4f6;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .root { --bg: #111827; --fg: #f9fafb; --muted: #9ca3af; --border: #374151; --bot: #1f2937; }
}
button { font: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.launcher {
  position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border: 0; border-radius: 50%;
  display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); box-shadow: 0 4px 14px rgb(0 0 0 / .25);
}
.panel {
  position: fixed; right: 20px; bottom: 88px; width: 360px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 112px);
  display: flex; flex-direction: column; overflow: hidden; background: var(--bg);
  border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / .2);
}
.panel[hidden] { display: none; }
@media (max-width: 480px) {
  .launcher { right: 16px; bottom: 16px; }
  .panel { left: 16px; right: 16px; bottom: 84px; width: auto; max-width: none; max-height: calc(100vh - 100px); }
}
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: rise .15s ease-out; }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
}
.head { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 10px 14px; background: var(--accent); color: var(--accent-fg); }
.head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.close { width: 32px; height: 32px; border: 0; border-radius: 6px; background: none; color: inherit; display: grid; place-items: center; }
.log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 85%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.user { align-self: flex-end; background: var(--accent); color: var(--accent-fg); border-bottom-right-radius: 4px; }
.bot { align-self: flex-start; background: var(--bot); border-bottom-left-radius: 4px; }
.note { margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
.source { display: block; margin-top: 6px; color: var(--muted); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chips small { width: 100%; color: var(--muted); font-size: 12px; }
.chip { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 13px; text-align: left; }
.chip:hover { border-color: var(--accent); }
.chip:disabled { opacity: .6; cursor: default; }
form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--border); }
input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; font-size: 16px; }
.send { padding: 8px 14px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; }
.send:disabled { opacity: .5; cursor: default; }
.agent { align-self: flex-start; background: var(--bot); border-left: 3px solid var(--accent); border-bottom-left-radius: 4px; }
.who { display: block; margin-bottom: 2px; color: var(--muted); font-size: 12px; font-weight: 600; }
.human, .opt { display: inline-block; padding: 6px 12px; border: 1px solid var(--accent); border-radius: 999px; background: var(--bg); color: var(--fg); font-size: 13px; text-decoration: none; }
.human { margin-top: 8px; font-weight: 600; }
.human:hover, .opt:hover { background: var(--accent); color: var(--accent-fg); }
.opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ticket { align-self: stretch; display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--border); border-top: 0; border-radius: 12px; }
.ticket p { margin: 0; color: var(--muted); font-size: 13px; }
.ticket label { font-size: 13px; font-weight: 600; }
.ticket textarea { resize: vertical; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; font-size: 16px; }
.ticket .row { display: flex; gap: 8px; margin-top: 4px; }
.ticket .err { color: #b91c1c; }
.cancel { padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); }
.banner { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
.banner[hidden] { display: none; }
.banner button { padding: 2px 6px; border: 0; background: none; color: var(--accent); text-decoration: underline; font-size: 13px; }
@media (prefers-color-scheme: dark) { .ticket .err { color: #fca5a5; } .banner button { color: #93c5fd; } }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

  const ICON_CHAT = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /** Element with attributes; children are nodes or strings (inserted as text). */
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) if (c != null) node.append(c);
    return node;
  };

  // Session storage keeps the chat across page loads on the site; it may be blocked, so every access is guarded.
  const load = () => { try { return JSON.parse(sessionStorage.getItem(storeKey)); } catch { return null; } };
  const state = load() || { conversationId: undefined, open: false, messages: [] };
  if (!state.messages.length) state.messages.push({ role: "bot", text: greeting });
  const save = () => {
    state.messages = state.messages.slice(-MAX_STORED);
    try { sessionStorage.setItem(storeKey, JSON.stringify(state)); } catch { /* chat still works, just not across pages */ }
  };

  function mount() {
    const host = el("div", { id: "chatbot-widget" });
    const shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;

    const launcher = el("button", { class: "launcher", type: "button", "aria-controls": "chatbot-panel" });
    const close = el("button", { class: "close", type: "button", "aria-label": "Close chat" });
    close.innerHTML = ICON_CLOSE;
    const log = el("div", { class: "log", role: "log", "aria-live": "polite" });
    const input = el("input", { type: "text", maxlength: "500", autocomplete: "off", placeholder: "Type your question…", id: "chatbot-q" });
    const send = el("button", { class: "send", type: "submit" }, "Send");
    const form = el("form", {}, el("label", { class: "sr", for: "chatbot-q" }, "Your question"), input, send);
    // Shown while the visitor's messages go to a ticket thread (a person) instead of the bot.
    const backToBot = el("button", { type: "button" }, "Back to the bot");
    const banner = el("div", { class: "banner" }, el("span", {}, "You’re messaging our team"), backToBot);
    const panel = el("div", { class: "panel", id: "chatbot-panel", role: "dialog", "aria-label": title },
      el("div", { class: "head" }, el("h2", {}, title), close), log, banner, form);
    shadow.append(style, el("div", { class: "root" }, panel, launcher));
    document.body.append(host);

    let busy = false;
    const setBusy = (b) => {
      busy = b;
      send.disabled = b || !input.value.trim();
      for (const chip of log.querySelectorAll(".chip")) chip.disabled = b;
    };
    input.addEventListener("input", () => setBusy(busy));

    let fieldId = 0;
    const field = (label, control) => {
      control.id = `chatbot-f${++fieldId}`;
      return [el("label", { for: control.id }, label), control];
    };

    /** "Talk to a human" and the knowledge base's channels. Expanded at once when the visitor asked for a person. */
    function handoffBlock(h) {
      const options = el("div", { class: "options" });
      const link = (label, href, newTab) => el("a", { class: "opt", href, ...(newTab ? { target: "_blank", rel: "noopener" } : {}) }, label);
      const action = (label, fn) => {
        const b = el("button", { class: "opt", type: "button" }, label);
        b.addEventListener("click", fn);
        return b;
      };
      if (h.live) options.append(action("Chat with an agent", () => ticketForm(h.question, true)));
      if (h.ticket) options.append(action("Leave a message", () => ticketForm(h.question, false)));
      if (h.email) options.append(link("Email us", `mailto:${h.email}?subject=${encodeURIComponent("Question from the website chat")}&body=${encodeURIComponent(h.question)}`, false));
      if (h.whatsapp) options.append(link("WhatsApp", `https://wa.me/${h.whatsapp}?text=${encodeURIComponent(h.question)}`, true));
      if (h.contactUrl) options.append(link("Contact form", h.contactUrl, true));
      if (h.reason === "requested") return options;
      const human = el("button", { class: "human", type: "button" }, "Talk to a human");
      human.addEventListener("click", () => { human.replaceWith(options); options.firstChild.focus(); });
      return human;
    }

    /** Opens a ticket thread. Live: an agent answers in this window. Otherwise: the team replies by email. */
    function ticketForm(question, live) {
      if (state.ticket) { setThread(state.ticket); input.focus(); return; }
      const message = el("textarea", { rows: "3", maxlength: "2000", required: "" });
      message.value = question;
      const email = el("input", { type: "email", maxlength: "254", autocomplete: "email", ...(live ? {} : { required: "" }) });
      const name = el("input", { type: "text", maxlength: "100", autocomplete: "name" });
      const submit = el("button", { class: "send", type: "submit" }, live ? "Start chat" : "Send message");
      const cancel = el("button", { class: "cancel", type: "button" }, "Cancel");
      const error = el("p", { class: "err", role: "alert" });
      const f = el("form", { class: "ticket", "aria-label": live ? "Chat with an agent" : "Leave a message" },
        el("p", {}, live ? "An agent will reply here. Leave your email in case you can’t wait." : "Our team will reply by email."),
        ...field("Your message", message), ...field(live ? "Email (optional)" : "Email", email), ...field("Name (optional)", name),
        error, el("div", { class: "row" }, submit, cancel));
      cancel.addEventListener("click", () => f.remove());
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const res = await fetch(ticketsApi, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ knowledgeBaseId: kb, conversationId: state.conversationId, live, message: message.value, email: email.value, name: name.value }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          f.remove();
          add({ role: "user", text: message.value.trim() });
          add({ role: "bot", text: live
            ? "Thanks! An agent will reply here shortly. Keep this window open."
            : `Thanks! We’ve sent your message to our team. They’ll reply to ${email.value.trim()}.` });
          setThread({ id: data.id, live, lastId: 0 });
          sync(data.messages);
          input.focus();
        } catch (err) {
          error.textContent = `Couldn’t send: ${err.message}`;
          submit.disabled = false;
        }
      });
      log.append(f);
      log.scrollTop = log.scrollHeight;
      message.focus();
    }

    /** Enters (thread) or leaves (null) the mode where the input goes to the team instead of the bot. */
    function setThread(t) {
      state.ticket = t;
      save();
      banner.hidden = !t;
      input.placeholder = t ? "Message our team…" : "Type your question…";
    }

    /** Shows agent messages newer than the last one seen. The visitor's own are already on screen. */
    function sync(messages) {
      const t = state.ticket;
      if (!t) return;
      for (const m of messages) {
        if (m.id <= t.lastId) continue;
        if (m.author === "agent") add({ role: "agent", text: m.body });
        t.lastId = m.id;
      }
      save();
    }

    function closedThread() {
      add({ role: "bot", text: "Our team has closed this conversation. You can keep asking me questions." });
      setThread(null);
    }

    async function sendToTeam(text) {
      const t = state.ticket;
      add({ role: "user", text });
      input.value = "";
      setBusy(true);
      try {
        const res = await fetch(`${ticketsApi}/${t.id}/messages`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text }),
        });
        if (res.status === 409 || res.status === 404) return closedThread();
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        sync(data.messages);
      } catch (e) {
        console.warn("chat widget:", e);
        add({ role: "bot", text: "Sorry, your message didn’t reach our team. Please try again." });
      } finally {
        setBusy(false);
        input.focus();
      }
    }

    // Agent replies arrive by polling, only while the panel is open and the page is visible.
    let polling = false;
    setInterval(async () => {
      const t = state.ticket;
      if (!t || !state.open || document.hidden || polling) return;
      polling = true;
      try {
        const res = await fetch(`${ticketsApi}/${t.id}`);
        if (res.status === 404) return closedThread();
        if (!res.ok) return;
        const data = await res.json();
        if (state.ticket !== t) return;
        sync(data.messages);
        if (data.status === "closed") closedThread();
      } catch { /* offline: try again next tick */ } finally {
        polling = false;
      }
    }, POLL_MS);

    function render(m) {
      const node = el("div", { class: `msg ${m.role}` });
      if (m.role === "agent") node.append(el("span", { class: "who" }, "Support team"));
      node.append(m.text);
      if (m.handoff) node.append(handoffBlock(m.handoff));
      if (m.clarification) node.append(el("p", { class: "note" }, m.clarification));
      if (m.source) node.append(el("small", { class: "source" }, `Source: ${m.source}`));
      if (m.related && m.related.length) {
        const chips = el("div", { class: "chips" }, el("small", {}, m.found && !m.clarification ? "Related:" : "Did you mean:"));
        for (const q of m.related) {
          const chip = el("button", { class: "chip", type: "button" }, q);
          chip.addEventListener("click", () => ask(q));
          chips.append(chip);
        }
        node.append(chips);
      }
      log.append(node);
      log.scrollTop = log.scrollHeight;
    }
    const add = (m) => { state.messages.push(m); save(); render(m); };

    async function ask(text) {
      text = text.trim();
      if (!text || busy) return;
      add({ role: "user", text });
      input.value = "";
      setBusy(true);
      const typing = el("div", { class: "msg bot" }, el("span", { "aria-hidden": "true" }, "…"), el("span", { class: "sr" }, "Typing"));
      log.append(typing);
      log.scrollTop = log.scrollHeight;
      try {
        const res = await fetch(api, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ knowledgeBaseId: kb, conversationId: state.conversationId, message: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        state.conversationId = data.conversationId;
        const s = data.source;
        add({
          role: "bot",
          text: data.answer,
          found: data.found,
          clarification: data.clarification,
          source: s && s.type !== "intent" ? (s.heading ? `${s.title} · ${s.heading}` : s.title) : null,
          related: (data.related || []).map((r) => r.question),
          handoff: data.handoff,
        });
      } catch (e) {
        console.warn("chat widget:", e);
        add({ role: "bot", text: "Sorry, something went wrong. Please try again in a moment." });
      } finally {
        typing.remove();
        setBusy(false);
        input.focus();
      }
    }

    function setOpen(open, focus = true) {
      state.open = open;
      save();
      panel.hidden = !open;
      launcher.setAttribute("aria-expanded", String(open));
      launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      launcher.innerHTML = open ? ICON_CLOSE : ICON_CHAT;
      if (!focus) return;
      if (open) { log.scrollTop = log.scrollHeight; input.focus(); } else launcher.focus();
    }

    launcher.addEventListener("click", () => setOpen(!state.open));
    close.addEventListener("click", () => setOpen(false));
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || busy) return;
      if (state.ticket) sendToTeam(text); else ask(text);
    });
    backToBot.addEventListener("click", () => { setThread(null); input.focus(); });

    for (const m of state.messages) render(m);
    setThread(state.ticket || null);
    setBusy(false);
    setOpen(state.open, false);
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();

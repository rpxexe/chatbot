/*
 * Website chat widget. Paste on any page:
 *
 *   <script src="https://<chatbot host>/widget.js" data-kb="<knowledge base slug>" async></script>
 *
 * Optional: data-title (header text and the "Ask …" intro, default "Footnote"), data-greeting (first message).
 * This script only draws the launcher button. The chat itself is the app's /widget page in a frame, so the page's CSS
 * cannot reach it. The frame loads on first hover or open. The page can call window.chatbotWidget.open() / .close().
 */
(() => {
  "use strict";
  if (window.__chatbotWidget) return;
  window.__chatbotWidget = true;

  const script = document.currentScript || document.querySelector('script[src*="/widget.js"]');
  if (!script) return;
  const origin = new URL(script.src).origin;
  const kb = script.getAttribute("data-kb") || "default";
  const src = new URL("/widget", origin);
  src.searchParams.set("kb", kb);
  for (const k of ["title", "greeting"]) {
    const v = script.getAttribute(`data-${k}`);
    if (v) src.searchParams.set(k, v);
  }
  const storeKey = `chatbot-widget-open:${kb}`;
  const introKey = `chatbot-widget-intro:${kb}`;
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* blocked storage: forgets across pages */ } },
  };

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root { --ink: #171717; --ink-fg: #fafafa; --ring: #1f6b4a; --border: rgb(23 23 23 / .1); --ease: cubic-bezier(.22, 1, .36, 1); }
@media (prefers-color-scheme: dark) { .root { --ink: #ededed; --ink-fg: #141415; --ring: #5cc196; --border: rgb(237 237 237 / .1); } }
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; min-width: 52px; height: 52px; padding: 0; border: 0;
  border-radius: 26px; display: flex; align-items: center; justify-content: center; background: var(--ink); color: var(--ink-fg);
  cursor: pointer; box-shadow: 0 1px 2px rgb(0 0 0 / .12), 0 8px 24px rgb(0 0 0 / .14);
  transition: transform .2s var(--ease), opacity .3s ease;
}
/* Hidden until the saved look has loaded, so it never shows the default color or corner first. */
.root:not(.ready) .launcher { opacity: 0; transform: translateY(14px) scale(.7); pointer-events: none; visibility: hidden; }
/* A panel left open on the last page waits too, so it never opens in the default corner and colors first. */
.root:not(.ready) .panel { visibility: hidden; }
/*
 * First load of the session: the button arrives as a pill, "Ask <name>" types in letter by letter, then the pill folds
 * into the round button and the icon turns in. The label is the only thing that changes size (on this one fixed element).
 */
.label {
  max-width: 0; overflow: hidden; white-space: nowrap; opacity: 0;
  font: 500 15px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: -.01em;
  transition: max-width .55s cubic-bezier(.65, 0, .35, 1), padding .55s cubic-bezier(.65, 0, .35, 1), opacity .25s ease;
}
.intro .label { max-width: 240px; padding: 0 22px; opacity: 1; }
.ch { display: inline-block; white-space: pre; }
.intro .ch { animation: type .35s var(--ease) backwards; animation-delay: calc(.3s + var(--i) * 45ms); }
@keyframes type { from { opacity: 0; transform: translateY(6px); filter: blur(2px); } }
.intro .i-chat { opacity: 0; transform: rotate(-90deg) scale(.4); }
/* Once the text has typed in, a sheen sweeps across the pill (a moving strip, so no repaint of the text). */
.intro .launcher { overflow: hidden; }
.intro .launcher::after {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 45%; pointer-events: none;
  background: linear-gradient(100deg, transparent, color-mix(in srgb, var(--ink-fg) 30%, transparent), transparent);
  transform: translateX(-120%); animation: sheen .9s cubic-bezier(.45, 0, .55, 1) var(--sheen-delay, .9s) both;
}
@keyframes sheen { to { transform: translateX(260%); } }
.launcher:hover { transform: scale(1.06); }
.launcher:active { transform: scale(.94); }
.launcher:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
/* Both icons are always there, stacked: opening turns the chat icon out and the cross in, closing the reverse. */
.icon { position: absolute; inset: 0; display: grid; place-items: center; transition: transform .3s var(--ease), opacity .2s ease; }
.i-close { opacity: 0; transform: rotate(-90deg) scale(.4); }
.is-open .i-chat { opacity: 0; transform: rotate(90deg) scale(.4); }
.is-open .i-close { opacity: 1; transform: none; }
.badge {
  position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  display: grid; place-items: center; background: var(--badge, #e5484d); color: var(--badge-fg, #fff); box-shadow: 0 0 0 2px #fff;
  font: 600 11px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.badge[hidden] { display: none; }
/*
 * Closed panel stays in the page (the frame keeps its chat) but is invisible and unfocusable. It grows out of the
 * button's corner and shrinks back into it. Only opacity and transform animate: compositor work, no layout or repaint.
 */
.panel {
  position: fixed; right: 20px; bottom: 84px; z-index: 2147483000; width: 380px; max-width: calc(100vw - 32px);
  height: 600px; max-height: calc(100vh - 108px); border: 1px solid var(--border); border-radius: 16px; overflow: hidden;
  background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 12px 32px rgb(0 0 0 / .12);
  transform-origin: bottom right; opacity: 0; transform: translateY(10px) scale(.9); visibility: hidden; pointer-events: none;
  transition: opacity .15s ease-in, transform .18s cubic-bezier(.4, 0, 1, 1), visibility 0s .18s;
}
.panel.open {
  opacity: 1; transform: none; visibility: visible; pointer-events: auto;
  transition: opacity .2s ease-out, transform .32s cubic-bezier(.32, .72, 0, 1), visibility 0s;
}
@media (prefers-color-scheme: dark) { .panel:not(.light) { background: #19191b; } .badge { box-shadow: 0 0 0 2px #141415; } }
.panel.dark { background: #19191b; }
.left .launcher { right: auto; left: 20px; }
.left .panel { right: auto; left: 20px; transform-origin: bottom left; }
/* Top corners: button at the top, panel below it, growing downward. */
.top .launcher { bottom: auto; top: 20px; }
.top .panel { bottom: auto; top: 84px; transform-origin: top right; transform: translateY(-10px) scale(.9); }
.top.left .panel { transform-origin: top left; }
.top .panel.open { transform: none; }
/* The frame sits over a skeleton of the chat, so a slow first load shows its shape instead of an empty panel. */
.panel iframe { position: relative; z-index: 1; display: block; width: 100%; height: 100%; border: 0; background: transparent; }
.skel { position: absolute; inset: 0; display: flex; flex-direction: column; }
.skel-head { display: flex; flex-direction: column; gap: 6px; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.skel-body { display: flex; flex-direction: column; gap: 8px; padding: 24px 20px; }
.bar { height: 10px; border-radius: 5px; background: var(--border); }
.skel-input { margin: auto 16px 16px; height: 40px; border: 1px solid var(--border); border-radius: 12px; }
@media (prefers-reduced-motion: no-preference) {
  .bar { animation: dim 1.2s ease-in-out infinite alternate; }
  @keyframes dim { to { opacity: .4; } }
}
@media (max-width: 480px) {
  .launcher { right: 16px; bottom: 16px; }
  .left .launcher { right: auto; left: 16px; }
  .panel, .left .panel { left: 12px; right: 12px; bottom: 80px; width: auto; max-width: none; max-height: calc(100vh - 96px); }
  .top .launcher { top: 16px; }
  .top .panel { bottom: auto; top: 80px; }
}
/* The badge pops in; a reply that lands while closed shakes the button. */
@media (prefers-reduced-motion: no-preference) {
  .badge { animation: pop .2s var(--ease); }
  .shake { animation: shake .5s ease-in-out; }
  @keyframes pop { from { transform: scale(0); } }
  @keyframes shake {
    15% { transform: rotate(-14deg); } 30% { transform: rotate(12deg); } 45% { transform: rotate(-9deg); }
    60% { transform: rotate(6deg); } 75% { transform: rotate(-3deg); }
  }
}
@media (prefers-reduced-motion: reduce) { .panel, .panel.open, .icon, .launcher, .label { transition: none; } }
`;

  // Chat button icons, chosen in the dashboard's Customize tab (Lucide shapes; same set as app/(site)/admin/customize.tsx).
  const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    bubble: svg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'),
    chats: svg('<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>'),
    help: svg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
    headset: svg('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
    bot: svg('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>'),
  };
  const ICON_CHAT = ICONS.chat;
  const ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function mount() {
    const host = document.createElement("div");
    host.id = "chatbot-widget";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style><div class="root"><div class="panel" id="chatbot-panel"></div><button class="launcher" type="button" aria-controls="chatbot-panel"><span class="label" aria-hidden="true"></span><span class="icon i-chat">${ICON_CHAT}</span><span class="icon i-close">${ICON_CLOSE}</span><span class="badge" hidden></span></button></div>`;
    const root = shadow.querySelector(".root");
    const panel = shadow.querySelector(".panel");
    const launcher = shadow.querySelector(".launcher");
    const chatIcon = shadow.querySelector(".i-chat");
    const badge = shadow.querySelector(".badge");
    let frame = null;
    let isOpen = false;
    let unread = 0;
    // The chatbot's name: the script's data-title, else the Customize tab's title (set when it loads), else the product's.
    let name = script.getAttribute("data-title") || "Footnote";
    // The intro's Customize settings: on/off and its own text (else "Ask <name>").
    let introOn = true;
    let introText = "";
    document.body.append(host);

    function label() {
      launcher.setAttribute("aria-label", isOpen ? "Close chat" : unread ? `Open chat, ${unread} new ${unread === 1 ? "reply" : "replies"}` : "Open chat");
    }

    /**
     * The chat frame, created once: when the page is idle, on hover/focus of the button, or on open, whichever is first,
     * so an open usually shows a chat that is already there. Until it paints, a skeleton of the chat shows through.
     */
    function load() {
      if (frame) return;
      panel.insertAdjacentHTML("beforeend", '<div class="skel" aria-hidden="true"><div class="skel-head"><div class="bar" style="width:30%"></div><div class="bar" style="width:55%;height:8px"></div></div><div class="skel-body"><div class="bar" style="width:85%"></div><div class="bar" style="width:65%"></div></div><div class="skel-input"></div></div>');
      const skel = panel.lastElementChild;
      frame = document.createElement("iframe");
      frame.src = src.href;
      frame.title = name;
      frame.allow = "clipboard-write";
      frame.addEventListener("load", () => skel.remove(), { once: true });
      panel.append(frame);
    }

    function setOpen(open, focus = true) {
      // Open state survives page loads.
      store.set(storeKey, open ? "1" : "");
      if (open) { load(); root.classList.remove("intro"); }
      isOpen = open;
      panel.classList.toggle("open", open);
      root.classList.toggle("is-open", open);
      panel.setAttribute("aria-hidden", String(!open));
      if (open) { unread = 0; badge.hidden = true; }
      launcher.setAttribute("aria-expanded", String(open));
      label();
      if (focus) (open ? frame : launcher).focus();
    }
    launcher.addEventListener("pointerenter", load, { once: true });
    launcher.addEventListener("focus", load, { once: true });

    /** A reply landed while the panel was closed (the visitor closed it mid-answer, or an agent wrote): badge and shake. */
    function notify(count) {
      if (isOpen) return;
      unread += count;
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.hidden = false;
      label();
      launcher.classList.remove("shake");
      void launcher.offsetWidth; // restart the animation for back-to-back replies
      launcher.classList.add("shake");
    }
    launcher.addEventListener("animationend", (e) => { if (e.animationName === "shake") launcher.classList.remove("shake"); });

    launcher.addEventListener("click", () => setOpen(!isOpen));
    // From the frame: its close button / Escape key, and new replies.
    const onMessage = (e) => {
      if (e.origin !== origin || !frame || e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === "chatbot:close") setOpen(false);
      if (e.data.type === "chatbot:reply") notify(Math.max(1, Math.min(99, Number(e.data.count) || 1)));
    };
    window.addEventListener("message", onMessage);

    // For the host page: its own "Chat with us" buttons call open(); a single-page app calls destroy() when it leaves
    // the page that embedded the widget (the script can be added again later).
    window.chatbotWidget = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      destroy: () => {
        window.removeEventListener("message", onMessage);
        host.remove();
        delete window.chatbotWidget;
        window.__chatbotWidget = false;
      },
    };
    const wasOpen = store.get(storeKey) === "1";
    setOpen(wasOpen, false);

    /** Shows the button once its look is known. The first time this session, as the "Ask <name>" pill first. */
    let shown = false;
    function reveal() {
      if (shown) return;
      shown = true;
      const intro = introOn && !isOpen && store.get(introKey) !== "1" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (intro) {
        store.set(introKey, "1");
        const text = introText || `Ask ${name}`;
        // One span per character, each typed in a little after the last (--i). Text only: the name is never HTML.
        const lab = shadow.querySelector(".label");
        [...text].forEach((c, i) => {
          const s = document.createElement("span");
          s.className = "ch";
          s.style.setProperty("--i", String(i));
          s.textContent = c;
          lab.append(s);
        });
        // The sheen starts as the last letter lands and ends just as the pill folds (1400 + 45/letter ms, below).
        root.style.setProperty("--sheen-delay", `${500 + text.length * 45}ms`);
        root.classList.add("intro");
        setTimeout(() => root.classList.remove("intro"), 1400 + text.length * 45);
      }
      root.classList.add("ready");
    }
    // If the settings are slow, show the defaults rather than no button.
    setTimeout(reveal, 2500);
    // Preload once the host page has settled, so it never competes with the site's own loading.
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    window.addEventListener("load", () => idle(load, { timeout: 5000 }), { once: true });
    if (document.readyState === "complete") idle(load, { timeout: 5000 });

    // The dashboard's Customize settings: side, accent and theme. Until they load (or if they can't), the defaults show.
    fetch(new URL(`/api/widget/${encodeURIComponent(kb)}`, origin))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const a = (d && d.appearance) || {};
        if (!script.getAttribute("data-title") && a.title) name = a.title;
        if (frame) frame.title = name;
        introOn = a.intro !== false;
        introText = typeof a.introText === "string" ? a.introText : "";
        if (/^#[0-9a-f]{6}$/i.test(a.badge || "")) {
          root.style.setProperty("--badge", a.badge);
          root.style.setProperty("--badge-fg", onColor(a.badge));
        }
        root.classList.toggle("left", a.position === "left" || a.position === "top-left");
        root.classList.toggle("top", a.position === "top-right" || a.position === "top-left");
        if (ICONS[a.icon]) chatIcon.innerHTML = ICONS[a.icon];
        if (a.theme === "light" || a.theme === "dark") panel.classList.add(a.theme);
        // The frame's own background, so the panel never flashes the theme color behind a custom one.
        if (/^#[0-9a-f]{6}$/i.test(a.background || "")) panel.style.background = a.background;
        if (/^#[0-9a-f]{6}$/i.test(a.color || "")) {
          root.style.setProperty("--ink", a.color);
          root.style.setProperty("--ring", a.color);
          root.style.setProperty("--ink-fg", onColor(a.color));
        }
      })
      .catch(() => { /* defaults */ })
      .finally(reveal);
  }

  /** Black or white, whichever reads better on the accent (same rule as lib/appearance.ts). */
  function onColor(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();

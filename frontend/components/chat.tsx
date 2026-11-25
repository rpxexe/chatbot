"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, BookOpen, Check, Copy, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";

type Source =
  | { type: "faq"; id: number; question: string; category: string | null }
  | { type: "document"; id: number; title: string; heading: string }
  | { type: "intent"; id: number; name: string }
  | null;

type Handoff = { reason: "unanswered" | "requested"; question: string; email?: string; contactUrl?: string; whatsapp?: string; ticket?: boolean; live?: boolean } | null;

type Msg = { id: string } & (
  | { role: "user"; text: string }
  | { role: "agent"; text: string }
  | { role: "bot"; text: string; found: boolean; clarification: string | null; source: Source; related: { id: number; question: string }[]; handoff: Handoff }
);
type BotMsg = Extract<Msg, { role: "bot" }>;

/** A handoff thread: while set, the input goes to the team instead of the bot. lastId: the newest message already shown. */
type Thread = { id: string; live: boolean; lastId: number };

type Saved = { conversationId?: string; messages: Msg[]; thread: Thread | null };

const POLL_MS = 5000;
const MAX_STORED = 50;
const uid = () => crypto.randomUUID();
const kb = () => new URLSearchParams(location.search).get("kb") ?? undefined;
const bot = (text: string): Msg => ({ id: uid(), role: "bot", text, found: false, clarification: null, source: null, related: [], handoff: null });

/** The article an answer was quoted from. Small talk (intent responses) has none. */
const cite = (s: Source) =>
  !s || s.type === "intent" ? null : s.type === "faq" ? s.question : s.heading ? `${s.title} · ${s.heading}` : s.title;

/** JSON body of a response, or its error as an exception. */
async function json(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/**
 * The conversation and its input, built on shadcn AI Elements (Chat, Message, Prompt Input, Suggestion, Sources).
 * Scrolls inside its own box, so it works embedded (landing demo) and framed or full-page (/widget).
 * storageKey keeps the chat in sessionStorage, so the widget survives page loads on the customer's site.
 */
export function Chat({ empty, greeting, suggestions = [], storageKey, autoplay = false, sources = true, preview = false, className }: {
  empty?: ReactNode;
  greeting?: string;
  suggestions?: string[];
  storageKey?: string;
  autoplay?: boolean;
  /** Show which article an answer was quoted from. */
  sources?: boolean;
  /** Questions are not logged in analytics (the dashboard's Customize preview). */
  preview?: boolean;
  className?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [thread, setThreadState] = useState<Thread | null>(null);
  const [form, setForm] = useState<{ question: string; live: boolean } | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Lets the server read follow-ups ("what about international orders?") against the previous question.
  const conversationId = useRef<string | undefined>(undefined);
  const threadRef = useRef<Thread | null>(null);
  // State, not a ref: the save effect must not run in the same commit as the restore (it would store the empty first
  // render, which Strict Mode's second restore then reads back).
  const [loaded, setLoaded] = useState(!storageKey);

  const setThread = (t: Thread | null) => {
    threadRef.current = t;
    setThreadState(t);
  };
  const add = (...m: Msg[]) => setMessages((all) => [...all, ...m]);
  // Messages restored from storage appear at once; only new ones pop in, and only new replies notify the widget.
  const restored = useRef(new Set<string>());

  // In the widget frame: tell widget.js how many replies just arrived, so it can badge the closed launcher.
  const seen = useRef(0);
  useEffect(() => {
    const fresh = messages.slice(seen.current).filter((m) => m.role !== "user" && !restored.current.has(m.id));
    seen.current = messages.length;
    if (fresh.length && window.parent !== window) window.parent.postMessage({ type: "chatbot:reply", count: fresh.length }, "*");
  }, [messages]);

  // Storage may be blocked (private mode, third-party frames): the chat still works, just not across pages.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const s: Saved | null = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (s) {
        conversationId.current = s.conversationId;
        restored.current = new Set(s.messages.map((m) => m.id));
        setMessages(s.messages);
        setThread(s.thread);
      }
    } catch { /* start fresh */ }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !loaded) return;
    const s: Saved = { conversationId: conversationId.current, messages: messages.slice(-MAX_STORED), thread };
    try { sessionStorage.setItem(storageKey, JSON.stringify(s)); } catch { /* see above */ }
  }, [storageKey, loaded, messages, thread]);

  /** Shows agent messages newer than the last one seen. The visitor's own are already on screen. */
  function sync(list: { id: number; author: string; body: string }[]) {
    const t = threadRef.current;
    if (!t) return;
    const fresh = list.filter((m) => m.id > t.lastId);
    if (!fresh.length) return;
    add(...fresh.filter((m) => m.author === "agent").map((m): Msg => ({ id: uid(), role: "agent", text: m.body })));
    setThread({ ...t, lastId: fresh.at(-1)!.id });
  }

  function closeThread() {
    add(bot("Our team has closed this conversation. You can keep asking me questions."));
    setThread(null);
  }

  // Agent replies arrive by polling, only while the page is visible.
  useEffect(() => {
    if (!thread) return;
    let polling = false;
    const timer = setInterval(async () => {
      const t = threadRef.current;
      if (!t || document.hidden || polling) return;
      polling = true;
      try {
        const res = await fetch(`/api/tickets/${t.id}`);
        // The visitor may have left this thread ("Back to the bot") while the request was out.
        if (threadRef.current?.id !== t.id) return;
        if (res.status === 404) return closeThread();
        if (!res.ok) return;
        const data = await res.json();
        sync(data.messages);
        if (data.status === "closed") closeThread();
      } catch { /* offline: try again next tick */ } finally {
        polling = false;
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // Restart only when the thread itself changes, not on every lastId bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

  /** preview: not logged in analytics (the autoplay demo's own questions). */
  async function ask(text: string, demoQuestion = false) {
    text = text.trim();
    if (!text || busy) return;
    add({ id: uid(), role: "user", text });
    setInput("");
    setBusy(true);
    try {
      const data = await json(await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, kb: kb(), conversationId: conversationId.current, preview: preview || demoQuestion }),
      }));
      conversationId.current = data.conversationId;
      add({ id: uid(), role: "bot", text: data.answer, found: data.found, clarification: data.clarification, source: data.source, related: data.related ?? [], handoff: data.handoff });
    } catch (e) {
      add(bot(`Something went wrong: ${(e as Error).message}`));
    } finally {
      setBusy(false);
    }
  }

  async function sendToTeam(text: string) {
    const t = threadRef.current!;
    add({ id: uid(), role: "user", text });
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${t.id}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: text }),
      });
      if (res.status === 409 || res.status === 404) return closeThread();
      sync((await json(res)).messages);
    } catch {
      add(bot("Sorry, your message didn’t reach our team. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  // Autoplay (landing demo): type each suggestion into the field, press send, wait for the real answer, then the next.
  // Runs through the list once, and stops for good as soon as the visitor touches the chat.
  const demo = useRef(autoplay);
  const [pressing, setPressing] = useState(false);
  const askRef = useRef(ask);
  askRef.current = ask;
  const stopDemo = () => { demo.current = false; };

  useEffect(() => {
    if (!autoplay || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    const live = () => !cancelled && demo.current;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await sleep(1200 + suggestions.length * 180); // let the suggestions pop in first
      for (const q of suggestions) {
        for (let i = 1; i <= q.length; i++) {
          if (!live()) return;
          setInput(q.slice(0, i));
          await sleep(35 + Math.random() * 45);
        }
        await sleep(400);
        if (!live()) return;
        setPressing(true);
        await sleep(180);
        setPressing(false);
        await askRef.current(q, true);
        await sleep(2800);
      }
      demo.current = false;
    })();
    return () => { cancelled = true; };
    // Once per mount; suggestions are a literal on the landing page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    if (threadRef.current) sendToTeam(input.trim());
    else ask(input);
  }

  function openTicket(question: string, live: boolean) {
    if (threadRef.current) return inputRef.current?.focus();
    setForm({ question, live });
  }

  const starters = suggestions.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((q, i) => (
        <Button
          key={q}
          type="button"
          variant="outline"
          size="sm"
          // Pop in one after another.
          className="h-auto bg-card py-1.5 text-left font-normal whitespace-normal animate-in fade-in-0 zoom-in-90 slide-in-from-bottom-2 duration-300 [animation-fill-mode:both] motion-reduce:animate-none"
          style={{ animationDelay: `${300 + i * 180}ms` }}
          onClick={() => { stopDemo(); ask(q); }}
        >
          {q}
        </Button>
      ))}
    </div>
  );

  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      // The visitor takes over (mouse, touch or keyboard): drop the half-typed demo question.
      onPointerDown={() => { if (demo.current) { stopDemo(); setInput(""); } }}
      onKeyDownCapture={() => { if (demo.current) { stopDemo(); setInput(""); } }}
    >
      <MessageScrollerProvider autoScroll>
        <div className="relative min-h-0 flex-1">
          {messages.length === 0 && !form && !greeting ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto px-4 py-8 sm:px-6">
              {empty}
              {starters}
            </div>
          ) : (
            <MessageScroller>
              {/* data-lenis-prevent: wheel scrolls the conversation, not the smooth-scrolled page around it. */}
              <MessageScrollerViewport data-lenis-prevent>
                <MessageScrollerContent role="log" aria-live="polite" aria-busy={busy} className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
                  {/* The greeting always opens the thread, as the first bot message. Not stored, so it follows data-greeting. */}
                  {greeting && (
                    <MessageScrollerItem messageId="greeting">
                      <Message>
                        <MessageContent className="gap-4">
                          <p className="border-l-2 border-transparent pl-4 whitespace-pre-wrap">{greeting}</p>
                          {messages.length === 0 && <div className="pl-[18px]">{starters}</div>}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}
                  {messages.map((m) => (
                    <MessageScrollerItem
                      key={m.id}
                      messageId={m.id}
                      scrollAnchor={m.role === "user"}
                      className={cn(
                        !restored.current.has(m.id) && "animate-in fade-in-0 slide-in-from-bottom-3 zoom-in-[0.97] duration-300 ease-out motion-reduce:animate-none",
                        m.role === "user" ? "origin-bottom-right" : "origin-bottom-left",
                      )}
                    >
                      {m.role === "user" ? (
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end" variant="muted">
                              {/* --bubble: the Customize tab's message color (widget only); otherwise the theme's muted. */}
                              <BubbleContent className="whitespace-pre-wrap bg-[var(--bubble,var(--muted))]! text-[var(--bubble-foreground,var(--foreground))]!">{m.text}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      ) : m.role === "agent" ? (
                        <Message>
                          <MessageContent>
                            <MessageHeader className="px-0">Support team</MessageHeader>
                            <Bubble variant="outline">
                              <BubbleContent className="whitespace-pre-wrap">{m.text}</BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      ) : (
                        <BotMessage m={m} onAsk={ask} onTicket={openTicket} busy={busy} sources={sources} />
                      )}
                    </MessageScrollerItem>
                  ))}
                  {busy && (
                    <MessageScrollerItem messageId="busy" className="animate-in fade-in-0 duration-500 motion-reduce:animate-none">
                      <Trace>
                        <TraceLine status="running">
                          <TraceIcon><LoaderCircle className="animate-spin" /></TraceIcon>
                          <TraceTitle>{thread ? "Sending" : "Looking it up"}</TraceTitle>
                        </TraceLine>
                      </Trace>
                    </MessageScrollerItem>
                  )}
                  {form && (
                    <MessageScrollerItem messageId="ticket-form" className="animate-in fade-in-0 slide-in-from-bottom-3 duration-300 motion-reduce:animate-none">
                      <TicketForm
                        {...form}
                        conversationId={conversationId.current}
                        onCancel={() => setForm(null)}
                        onOpened={(t, message, email, list) => {
                          setForm(null);
                          add(
                            { id: uid(), role: "user", text: message },
                            bot(t.live ? "Thanks. An agent will reply here shortly. Keep this window open." : `Thanks. Your message is with our team. They’ll reply to ${email}.`),
                          );
                          setThread(t);
                          sync(list);
                          inputRef.current?.focus();
                        }}
                      />
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          )}
        </div>
      </MessageScrollerProvider>

      {thread && (
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 pb-2 text-sm text-subtle sm:px-6">
          <span>You’re messaging our team</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setThread(null)}>Back to the bot</Button>
        </div>
      )}

      <div className="pb-3 sm:pb-4">
        <form
          ref={formRef}
          className="mx-auto max-w-2xl px-4 sm:px-6"
          onSubmit={onSubmit}
        >
          <Label htmlFor="q" className="sr-only">Your question</Label>
          {/* Focus: a gradient border and a soft brand glow (below) instead of InputGroup's wide 3px ring. */}
          <InputGroup
            aria-busy={busy}
            className={cn(
              "relative rounded-xl bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-[border-color,box-shadow] duration-300 dark:bg-card has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:shadow-[0_6px_20px_-8px_color-mix(in_oklch,var(--brand)_45%,transparent),0_1px_2px_rgb(0_0_0/0.05)]",
              busy && "motion-reduce:border-brand/50",
            )}
          >
            {!busy && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-px rounded-[inherit] bg-[linear-gradient(120deg,var(--brand),color-mix(in_oklch,var(--brand)_25%,transparent)_45%,color-mix(in_oklch,var(--brand)_25%,transparent)_60%,var(--brand))] p-px opacity-0 transition-opacity duration-300 [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude] group-has-[[data-slot=input-group-control]:focus-visible]/input-group:opacity-100"
              />
            )}
            {/*
              Loading: a brand-colored light runs along the border (a strip masked to the 1px ring) and, much fainter,
              across the field. Only the strips move (transform), so it costs little. Reduced motion: a tinted border.
            */}
            {busy && (
              <span aria-hidden="true" className="pointer-events-none absolute -inset-px overflow-hidden rounded-[inherit] motion-reduce:hidden">
                <span className="absolute inset-0 overflow-hidden rounded-[inherit] p-px [mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [mask-composite:exclude]">
                  <span className="absolute inset-y-0 left-0 w-2/5 animate-[input-shimmer_1.6s_cubic-bezier(0.45,0,0.55,1)_infinite] bg-[linear-gradient(90deg,transparent,var(--brand),transparent)]" />
                </span>
                <span className="absolute inset-y-0 left-0 w-2/5 animate-[input-shimmer_1.6s_cubic-bezier(0.45,0,0.55,1)_infinite] bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--brand)_9%,transparent),transparent)]" />
              </span>
            )}
            <InputGroupTextarea
              id="q"
              ref={inputRef}
              rows={1}
              // text-base below md: iOS zooms into smaller inputs on focus.
              className="max-h-32 min-h-9 py-2 pl-3.5 text-base leading-5 md:text-sm"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              maxLength={thread ? 2000 : 500}
              aria-label={thread ? "Message our team" : "Ask a question"}
              autoComplete="off"
            />
            {!input && <Placeholder texts={thread ? ["Message our team"] : ["Ask a question", ...suggestions, ...HINTS].slice(0, 6)} />}
            <InputGroupAddon align="inline-end" className="self-end pb-1">
              <InputGroupButton type="submit" variant="default" size="icon-sm" className={cn("rounded-lg transition-transform aria-disabled:opacity-40", pressing && "scale-90 ring-3 ring-ring/50")} aria-label="Send" aria-disabled={busy || !input.trim()}>
                <ArrowUp strokeWidth={1.75} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  );
}

/** Placeholder examples after "Ask a question" and the chatbot's own starter questions. */
const HINTS = ["Try “Where is my order?”", "Try “How do refunds work?”", "Or ask to talk to a person"];

/**
 * An animated placeholder: the hints take turns, each sliding up into place. A native placeholder can't animate, so this
 * is an overlay; the field carries the same text as its aria-label. Reduced motion: the first hint, still.
 */
function Placeholder({ texts }: { texts: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (texts.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % texts.length), 3200);
    return () => clearInterval(t);
  }, [texts.length]);
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 right-12 flex items-center overflow-hidden text-base leading-5 text-muted-foreground md:text-sm">
      <span key={i} className="truncate animate-in fade-in-0 slide-in-from-bottom-3 duration-500 ease-out motion-reduce:animate-none">{texts[i % texts.length]}</span>
    </span>
  );
}

function BotMessage({ m, onAsk, onTicket, busy, sources }: { m: BotMsg; onAsk: (q: string) => void; onTicket: (q: string, live: boolean) => void; busy: boolean; sources: boolean }) {
  const source = sources ? cite(m.source) : null;
  return (
    <Message>
      <MessageContent className="gap-3">
        {/* Signature: an answer quoted from the help articles carries the green rule and its source. */}
        <div className={cn("border-l-2 pl-4", source ? "border-brand" : "border-transparent")}>
          <p className={cn("whitespace-pre-wrap", !m.found && "text-subtle")}>{m.text}</p>
          {source && (
            <Trace className="mt-2">
              <TraceLine>
                <TraceIcon><BookOpen className="text-brand" /></TraceIcon>
                <TraceTitle className="font-mono text-xs">From “{source}”</TraceTitle>
              </TraceLine>
            </Trace>
          )}
        </div>
        {m.clarification && <p className="pl-[18px] text-subtle">{m.clarification}</p>}
        {m.handoff && <HandoffOptions h={m.handoff} onTicket={onTicket} />}
        {m.related.length > 0 && (
          <div className="flex flex-col gap-2 pl-[18px]">
            <span className="text-xs text-muted-foreground">{m.found && !m.clarification ? "Related" : "Did you mean"}</span>
            <div className="flex flex-wrap gap-2">
              {m.related.map((r) => (
                <Button key={r.id} type="button" variant="outline" size="sm" className="h-auto py-1.5 text-left font-normal whitespace-normal" onClick={() => onAsk(r.question)} disabled={busy}>
                  {r.question}
                </Button>
              ))}
            </div>
          </div>
        )}
        {m.found && (
          <MessageFooter className="pl-[18px]">
            <CopyAction text={m.text} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const label = copied ? "Copied" : "Copy";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true), () => {})}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

/** "Talk to a person" and the knowledge base's channels. Expanded at once when the visitor asked for a person. */
function HandoffOptions({ h, onTicket }: { h: NonNullable<Handoff>; onTicket: (q: string, live: boolean) => void }) {
  const [open, setOpen] = useState(h.reason === "requested");
  const links = [
    h.email && { label: "Email us", href: `mailto:${h.email}?subject=${encodeURIComponent("Question from the website chat")}&body=${encodeURIComponent(h.question)}` },
    h.whatsapp && { label: "WhatsApp", href: `https://wa.me/${h.whatsapp}?text=${encodeURIComponent(h.question)}` },
    h.contactUrl && { label: "Contact form", href: h.contactUrl },
  ].filter(Boolean) as { label: string; href: string }[];
  if (!links.length && !h.live && !h.ticket) return null;
  const pill = "h-auto py-1.5 font-normal";
  if (!open) return <div className="pl-[18px]"><Button type="button" variant="outline" size="sm" className={pill} onClick={() => setOpen(true)}>Talk to a person</Button></div>;
  return (
    <div className="flex flex-wrap gap-2 pl-[18px]">
      {h.live && <Button type="button" variant="outline" size="sm" className={pill} onClick={() => onTicket(h.question, true)}>Chat with an agent</Button>}
      {h.ticket && <Button type="button" variant="outline" size="sm" className={pill} onClick={() => onTicket(h.question, false)}>Leave a message</Button>}
      {links.map((l) => (
        <Button key={l.label} variant="outline" size="sm" className={pill} asChild>
          <a href={l.href} {...(l.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener" })}>{l.label}</a>
        </Button>
      ))}
    </div>
  );
}

type TicketMsgs = { id: number; author: string; body: string }[];

/** Opens a ticket thread. Live: an agent answers in this window. Otherwise: the team replies by email. */
function TicketForm({ question, live, conversationId, onCancel, onOpened }: {
  question: string;
  live: boolean;
  conversationId?: string;
  onCancel: () => void;
  onOpened: (t: Thread, message: string, email: string, messages: TicketMsgs) => void;
}) {
  const [message, setMessage] = useState(question);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError("");
    try {
      const data = await json(await fetch("/api/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kb: kb(), conversationId, live, message, email, name }),
      }));
      onOpened({ id: data.id, live, lastId: 0 }, message.trim(), email.trim(), data.messages);
    } catch (err) {
      setError(`Couldn’t send: ${(err as Error).message}`);
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={live ? "Chat with an agent" : "Leave a message"} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm text-subtle">{live ? "An agent will reply here. Leave your email in case you can’t wait." : "Our team will reply by email."}</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="t-msg">Your message</Label>
        <Textarea id="t-msg" rows={3} maxLength={2000} required value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="t-email">{live ? "Email (optional)" : "Email"}</Label>
        <Input id="t-email" type="email" maxLength={254} autoComplete="email" required={!live} value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="t-name">Name (optional)</Label>
        <Input id="t-name" maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={sending}>{live ? "Start chat" : "Send message"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

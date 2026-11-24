"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";

type Source =
  | { type: "faq"; id: number; question: string; category: string | null }
  | { type: "document"; id: number; title: string; heading: string }
  | { type: "intent"; id: number; name: string }
  | null;

type Handoff = { reason: "unanswered" | "requested"; question: string; email?: string; contactUrl?: string; whatsapp?: string; ticket?: boolean; live?: boolean } | null;

type Msg =
  | { role: "user"; text: string }
  | { role: "bot"; text: string; found: boolean; clarification: string | null; source: Source; related: { id: number; question: string }[]; handoff: Handoff };

/** The article an answer was quoted from. Small talk (intent responses) has none. */
const cite = (s: Source) =>
  !s || s.type === "intent" ? null : s.type === "faq" ? s.question : s.heading ? `${s.title} · ${s.heading}` : s.title;

/** The conversation and its input. Scrolls inside its own box, so it works full-page (/chat) and embedded (landing demo). */
export function Chat({ empty, suggestions = [], className }: { empty?: ReactNode; suggestions?: string[]; className?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // Lets the server read follow-ups ("what about international orders?") against the previous question.
  const conversationId = useRef<string | undefined>(undefined);

  useEffect(() => {
    // Not scrollIntoView: embedded on the landing page, that would scroll the whole page.
    const el = listRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function ask(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          kb: new URLSearchParams(location.search).get("kb") ?? undefined,
          conversationId: conversationId.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      conversationId.current = data.conversationId;
      setMessages((m) => [...m, { role: "bot", text: data.answer, found: data.found, clarification: data.clarification, source: data.source, related: data.related, handoff: data.handoff }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "bot", text: `Something went wrong: ${(e as Error).message}`, found: false, clarification: null, source: null, related: [], handoff: null }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* data-lenis-prevent: wheel scrolls the conversation, not the smooth-scrolled page around it. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite" data-lenis-prevent>
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6">
          {messages.length === 0 && (
            <div className="flex flex-col gap-6">
              {empty}
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((q) => (
                    <Button key={q} type="button" variant="outline" size="sm" className="h-auto rounded-lg bg-card px-3 py-1.5 text-sm font-normal" onClick={() => ask(q)}>
                      {q}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m, i) => m.role === "user" ? (
            <p key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 whitespace-pre-wrap">{m.text}</p>
          ) : (
            <BotMessage key={i} m={m} onAsk={ask} busy={busy} />
          ))}
          {busy && <p className="pl-[18px] text-sm text-muted-foreground">Looking it up</p>}
        </div>
      </div>

      <div className="pb-4 sm:pb-6">
        <form
          className="mx-auto max-w-2xl px-4 sm:px-6"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Label htmlFor="q" className="sr-only">Your question</Label>
          <InputGroup className="h-12 rounded-xl bg-card shadow-[0_1px_2px_rgb(0_0_0/0.05)] dark:bg-card">
            <InputGroupInput
              id="q"
              className="pl-4 text-base md:text-base"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              placeholder="Ask a question"
              autoComplete="off"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-lg aria-disabled:opacity-40" aria-label="Send" aria-disabled={busy || !input.trim()}>
                <ArrowUp strokeWidth={1.75} aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  );
}

function BotMessage({ m, onAsk, busy }: { m: Extract<Msg, { role: "bot" }>; onAsk: (q: string) => void; busy: boolean }) {
  const source = cite(m.source);
  return (
    <div className="flex flex-col gap-3">
      {/* Signature: an answer quoted from the help articles carries the green rule and its source. */}
      <div className={cn("border-l-2 pl-4", source ? "border-brand" : "border-transparent")}>
        <p className={cn("whitespace-pre-wrap", !m.found && "text-subtle")}>{m.text}</p>
        {source && <p className="mt-2 font-mono text-xs text-muted-foreground">From “{source}”</p>}
      </div>
      {m.clarification && <p className="pl-[18px] text-sm text-subtle">{m.clarification}</p>}
      {m.handoff && <HandoffLinks h={m.handoff} />}
      {m.related.length > 0 && (
        <div className="flex flex-col gap-2 pl-[18px]">
          <span className="text-xs text-muted-foreground">{m.found && !m.clarification ? "Related" : "Did you mean"}</span>
          <div className="flex flex-wrap gap-2">
            {m.related.map((r) => (
              <Button key={r.id} type="button" variant="outline" size="sm" className="h-auto rounded-lg bg-card px-3 py-1.5 text-left text-sm font-normal whitespace-normal" onClick={() => onAsk(r.question)} disabled={busy}>
                {r.question}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Talk to a human" with the knowledge base's link channels. Tickets and live agents need the polling thread, which only
 * the website widget (public/widget.js) has.
 */
function HandoffLinks({ h }: { h: NonNullable<Handoff> }) {
  const [open, setOpen] = useState(h.reason === "requested");
  const links = [
    h.email && { label: "Email us", href: `mailto:${h.email}?subject=${encodeURIComponent("Question from the website chat")}&body=${encodeURIComponent(h.question)}` },
    h.whatsapp && { label: "WhatsApp", href: `https://wa.me/${h.whatsapp}?text=${encodeURIComponent(h.question)}` },
    h.contactUrl && { label: "Contact form", href: h.contactUrl },
  ].filter(Boolean) as { label: string; href: string }[];
  if (!links.length) return null;
  const pill = "h-auto rounded-lg bg-card px-3 py-1.5 text-sm font-normal";
  if (!open) return <div className="pl-[18px]"><Button type="button" variant="outline" size="sm" className={pill} onClick={() => setOpen(true)}>Talk to a person</Button></div>;
  return (
    <div className="flex flex-wrap gap-2 pl-[18px]">
      {links.map((l) => (
        <Button key={l.label} variant="outline" size="sm" className={pill} asChild>
          <a href={l.href} {...(l.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener" })}>{l.label}</a>
        </Button>
      ))}
    </div>
  );
}

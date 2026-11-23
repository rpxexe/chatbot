"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Lets the server read follow-ups ("what about international orders?") against the previous question.
  const conversationId = useRef<string | undefined>(undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      setMessages((m) => [...m, { role: "bot", text: `Error: ${(e as Error).message}`, found: false, clarification: null, source: null, related: [], handoff: null }]);
    } finally {
      setBusy(false);
    }
  }

  const bubble = (role: Msg["role"]) =>
    cn(
      "max-w-[85%] rounded-xl px-3.5 py-2.5",
      role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start border bg-card text-card-foreground",
    );

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col p-4">
      <h1 className="mb-3 text-xl font-semibold">Help Assistant</h1>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-3" aria-live="polite">
        {messages.length === 0 && <p className="text-muted-foreground">Ask a question, e.g. “What is your refund policy?”</p>}
        {messages.map((m, i) => (
          <div key={i} className={bubble(m.role)}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.role === "bot" && m.clarification && <p className="mt-2 border-t pt-2 text-sm text-muted-foreground">{m.clarification}</p>}
            {m.role === "bot" && m.source && m.source.type !== "intent" && (
              <small className="mt-1.5 block text-muted-foreground">
                {m.source.type === "faq"
                  ? `From FAQ${m.source.category ? ` · ${m.source.category}` : ""}`
                  : `From “${m.source.title}”${m.source.heading ? ` · ${m.source.heading}` : ""}`}
              </small>
            )}
            {m.role === "bot" && m.handoff && <HandoffLinks h={m.handoff} />}
            {m.role === "bot" && m.related.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <small className="text-muted-foreground">{m.found && !m.clarification ? "Related:" : "Did you mean:"}</small>
                {m.related.map((r) => (
                  <Button key={r.id} type="button" variant="outline" size="sm" className="h-auto rounded-full py-1 whitespace-normal" onClick={() => ask(r.question)} disabled={busy}>
                    {r.question}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className={bubble("bot")}><p>…</p></div>}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <Label htmlFor="q" className="sr-only">Your question</Label>
        <Input id="q" className="h-10 flex-1" value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="Type your question…" autoComplete="off" />
        <Button type="submit" size="lg" className="h-10 px-4" disabled={busy || !input.trim()}>Send</Button>
      </form>
    </main>
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
  if (!open) return <Button type="button" variant="outline" size="sm" className="mt-2 rounded-full" onClick={() => setOpen(true)}>Talk to a human</Button>;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <Button key={l.label} variant="outline" size="sm" className="rounded-full" asChild>
          <a href={l.href} {...(l.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noopener" })}>{l.label}</a>
        </Button>
      ))}
    </div>
  );
}

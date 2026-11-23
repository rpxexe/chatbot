"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Kb } from "./api";

type Signals = { bm25: number; keyword: number; phrase: number; question: number; fuzzy: number };
type Ranked = { type: "faq" | "document"; id: number; title: string; category: string | null; score: number; boost: number; signals: Signals; matched: string[] };
type IntentHit = { id: number; name: string; confidence: number; matched: string[] };
type Result = {
  found: boolean;
  answer: string;
  score: number;
  confidence: number;
  level: "high" | "medium" | "low";
  clarification: string | null;
  handoff: { reason: "unanswered" | "requested"; email?: string; contactUrl?: string; whatsapp?: string; ticket?: boolean; live?: boolean } | null;
  via: "intent" | "search" | "intent_fallback" | "none";
  intent: IntentHit | null;
  intents: IntentHit[];
  entities: Record<string, string[]>;
  related: { id: number; question: string }[];
  results: Ranked[];
  conversationId: string;
  followUp: { previousQuestion: string | null; query: string } | null;
};

const VIA_LABEL: Record<Result["via"], string> = {
  intent: "Fixed response of the detected intent",
  search: "Best search result",
  intent_fallback: "Best entry tagged with the detected intent (weak word match)",
  none: "No result reached the answer threshold",
};

const LEVEL_LABEL: Record<Result["level"], string> = {
  high: "high (≥ 0.80): answered",
  medium: "medium (0.50–0.79): best match + clarification",
  low: "low (< 0.50): no answer given",
};

const SIGNAL_LABELS: [keyof Signals, string][] = [
  ["bm25", "BM25"], ["keyword", "Keywords"], ["phrase", "Phrase"], ["question", "Question similarity"], ["fuzzy", "Fuzzy"],
];

/** Asks the public chat endpoint exactly as a visitor would, so disabled content is excluded here too. */
export function PreviewPanel({ kb }: { kb: Kb }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(message: string) {
    if (!message.trim()) return;
    setBusy(true); setError(""); setAsked(message);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // preview: the owner's test questions are not logged in analytics.
        body: JSON.stringify({ message, kb: kb.slug, conversationId: result?.conversationId, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
      setOpen(0);
    } catch (e) {
      setError((e as Error).message); setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const h3 = "mt-3 mb-1 text-sm font-semibold";

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-semibold">Preview answers</h2>
      <p className="text-sm text-muted-foreground">
        Ask as a visitor of “{kb.name}” would. Disabled content is not used. Questions continue one conversation, so follow-ups work.{" "}
        {result && <Button type="button" variant="link" className="h-auto p-0" onClick={() => { setResult(null); setAsked(""); }}>New conversation</Button>}
      </p>
      <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); ask(q); }}>
        <Label htmlFor="preview-q" className="sr-only">Test question</Label>
        <Input id="preview-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Type a test question…" />
        <Button disabled={busy || !q.trim()}>Ask</Button>
      </form>
      {error && <Alert variant="destructive"><AlertDescription className="text-destructive">{error}</AlertDescription></Alert>}
      {result && (
        <div className="border-t pt-3" aria-live="polite">
          <p className="mb-2 text-sm text-muted-foreground">Q: {asked}</p>
          {result.followUp && (
            <p className="mb-2 text-sm text-muted-foreground">Follow-up to “{result.followUp.previousQuestion}”. Searched: “{result.followUp.query}”</p>
          )}
          <p className={cn("mb-2 whitespace-pre-wrap", !result.found && "text-muted-foreground")}>{result.answer}</p>
          {result.clarification && <p className="mb-2 text-sm text-muted-foreground">{result.clarification}</p>}
          <p className="text-sm text-muted-foreground">{VIA_LABEL[result.via]}</p>
          {result.handoff && (
            <p className="text-sm">
              <strong>Talk to a human</strong> offered ({result.handoff.reason === "requested" ? "visitor asked for a person" : "no answer"}):{" "}
              {[result.handoff.email && "email", result.handoff.contactUrl && "contact form", result.handoff.whatsapp && "WhatsApp",
                result.handoff.ticket && "leave a message", result.handoff.live && "live agent"].filter(Boolean).join(", ")}
            </p>
          )}
          <p className="text-sm">
            Confidence <strong className="tabular-nums">{result.confidence.toFixed(2)}</strong>
            <span className="text-muted-foreground"> · {LEVEL_LABEL[result.level]}</span>
          </p>

          <h3 className={h3}>Intent</h3>
          {result.intents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No intent pattern matched.</p>
          ) : (
            <ul className="mb-1 flex flex-col gap-0.5 text-sm">
              {result.intents.map((i) => {
                const winner = result.intent?.id === i.id;
                return (
                  <li key={i.id} className={winner ? "" : "text-muted-foreground"}>
                    <strong className={winner ? "text-primary" : ""}>{i.name}</strong> {i.confidence.toFixed(2)}
                    <span className="text-muted-foreground"> · matched {i.matched.join(", ")}</span>
                    {!winner && i === result.intents[0] && <span className="text-muted-foreground"> · below detection threshold</span>}
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className={h3}>Entities</h3>
          {Object.keys(result.entities).length === 0 ? (
            <p className="text-sm text-muted-foreground">No order ID, email, phone, date, price, product, plan, category or location found.</p>
          ) : (
            <dl className="mb-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-sm">
              {Object.entries(result.entities).map(([kind, values]) => (
                <div key={kind} className="contents">
                  <dt className="text-muted-foreground">{kind}</dt>
                  <dd>{values.join(", ")}</dd>
                </div>
              ))}
            </dl>
          )}

          <h3 className={h3}>Search results</h3>
          {result.results.length === 0 && <p className="text-sm text-muted-foreground">Nothing in this knowledge base matched any word of the question.</p>}
          <ol className="mb-2 flex flex-col gap-1.5">
            {result.results.map((r, i) => {
              const winner = i === 0 && (result.via === "search" || result.via === "intent_fallback");
              return (
                <Collapsible key={`${r.type}-${r.id}`} asChild open={open === i} onOpenChange={(o) => setOpen(o ? i : null)}>
                  <li>
                    <CollapsibleTrigger className="flex w-full justify-between gap-2 py-0.5 text-left text-sm">
                      <span className={cn("truncate", winner && "font-semibold")}>{r.title}</span>
                      <span className="font-semibold tabular-nums">{r.score.toFixed(2)}</span>
                    </CollapsibleTrigger>
                    <div className="h-1 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                      <span className={cn("block h-full", winner ? "bg-primary" : "bg-muted-foreground")} style={{ width: `${Math.round(r.score * 100)}%` }} />
                    </div>
                    <CollapsibleContent className="flex flex-col gap-1 pt-1.5 pb-1 text-sm">
                      <div className="text-muted-foreground">{r.type === "faq" ? "FAQ" : "Document section"}{r.category ? ` · ${r.category}` : ""}</div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                        {SIGNAL_LABELS.map(([k, label]) => (
                          <div key={k} className="contents">
                            <dt className="text-muted-foreground">{label}</dt>
                            <dd>{r.signals[k].toFixed(2)}</dd>
                          </div>
                        ))}
                      </dl>
                      {r.matched.length > 0 && <div><span className="text-muted-foreground">Matched: </span>{r.matched.join(", ")}</div>}
                      {r.boost > 0 && <div><span className="text-muted-foreground">Intent tag boost: </span>+{r.boost.toFixed(2)}</div>}
                    </CollapsibleContent>
                  </li>
                </Collapsible>
              );
            })}
          </ol>

          {result.related.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <small className="text-muted-foreground">{result.found && !result.clarification ? "Related:" : "Did you mean:"}</small>
              {result.related.map((r) => (
                <Button key={r.id} type="button" variant="outline" size="sm" className="h-auto rounded-full py-1 whitespace-normal" onClick={() => { setQ(r.question); ask(r.question); }}>{r.question}</Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

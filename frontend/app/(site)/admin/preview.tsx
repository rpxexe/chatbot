"use client";

import { useState, type FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CHAT_INPUT } from "@/components/chat";
import type { Kb } from "./api";

type Signals = { bm25: number; keyword: number; phrase: number; question: number; fuzzy: number };
type Ranked = { type: "faq" | "document"; id: number; title: string; category: string | null; score: number; boost: number; signals: Signals; matched: string[] };
type IntentHit = { id: number; name: string; confidence: number; matched: string[] };
type Source =
  | { type: "faq"; id: number; question: string; category: string | null }
  | { type: "document"; id: number; title: string; heading: string }
  | { type: "intent"; id: number; name: string }
  | null;
type Result = {
  found: boolean;
  answer: string;
  score: number;
  confidence: number;
  level: "high" | "medium" | "low";
  clarification: string | null;
  source: Source;
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
  high: "high, answered",
  medium: "medium, best match + clarification",
  low: "low, no answer given",
};

const SIGNAL_LABELS: [keyof Signals, string][] = [
  ["bm25", "BM25"], ["keyword", "Keywords"], ["phrase", "Phrase"], ["question", "Question similarity"], ["fuzzy", "Fuzzy"],
];

/** Where an answer came from, as the visitor sees it under the answer. */
export function sourceLabel(s: Source) {
  if (!s || s.type === "intent") return null;
  return s.type === "faq" ? s.question : `${s.title}${s.heading ? ` · ${s.heading}` : ""}`;
}

/** Asks the public chat endpoint exactly as a visitor would, so disabled content is excluded here too. */
export function PreviewPanel({ kb }: { kb: Kb }) {
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask(message: string) {
    if (!message.trim() || busy) return;
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
      setQ("");
      setOpen(0);
    } catch (e) {
      setError((e as Error).message); setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const h3 = "mb-2 text-xs text-muted-foreground";
  const source = result && sourceLabel(result.source);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-medium">Test a question</h2>
          {result && <Button type="button" variant="link" className="h-auto p-0 text-xs text-subtle" onClick={() => { setResult(null); setAsked(""); }}>New conversation</Button>}
        </div>
        <p className="mt-1 text-sm text-subtle">Answers exactly as visitors of {kb.name} get them, without counting in analytics</p>
      </div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(q); }}>
        <Label htmlFor="preview-q" className="sr-only">Test question</Label>
        <InputGroup aria-busy={busy} className={cn(CHAT_INPUT, "h-10")}>
          <InputGroupInput id="preview-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Ask like a visitor would" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" size="icon-xs" className="aria-disabled:opacity-40" aria-label="Ask" aria-disabled={busy || !q.trim()}>
              <ArrowUp strokeWidth={1.75} aria-hidden="true" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {error && <Alert variant="destructive"><AlertDescription className="text-destructive">{error}</AlertDescription></Alert>}
      {result && (
        <div className="flex flex-col gap-5 border-t pt-4" aria-live="polite">
          <div className="flex flex-col gap-2">
            <p className="text-sm text-subtle">“{asked}”</p>
            {result.followUp && (
              <p className="text-xs text-muted-foreground">Read as a follow-up to “{result.followUp.previousQuestion}”. Searched “{result.followUp.query}”</p>
            )}
            {/* Signature: answers that come from the content carry the green rule and their source. */}
            <div className={cn("pl-3", source ? "border-l-2 border-brand" : "border-l-2 border-transparent")}>
              <p className={cn("whitespace-pre-wrap", !result.found && "text-subtle")}>{result.answer}</p>
              {source && <p className="mt-1.5 font-mono text-xs text-muted-foreground">From “{source}”</p>}
            </div>
            {result.clarification && <p className="text-sm text-subtle">{result.clarification}</p>}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Confidence</dt>
            <dd><span className="font-mono tabular-nums">{result.confidence.toFixed(2)}</span> <span className="text-subtle">{LEVEL_LABEL[result.level]}</span></dd>
            <dt className="text-muted-foreground">Rule</dt>
            <dd className="text-subtle">{VIA_LABEL[result.via]}</dd>
            {result.handoff && (
              <>
                <dt className="text-muted-foreground">Handoff</dt>
                <dd className="text-subtle">
                  {result.handoff.reason === "requested" ? "Visitor asked for a person" : "Offered, no answer"}:{" "}
                  {[result.handoff.contactUrl && "contact form", result.handoff.whatsapp && "WhatsApp",
                    result.handoff.ticket && "leave a message", result.handoff.live && "live agent"].filter(Boolean).join(", ")}
                </dd>
              </>
            )}
          </dl>

          <section>
            <h3 className={h3}>Intent</h3>
            {result.intents.length === 0 ? (
              <p className="text-sm text-subtle">No intent pattern matched</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {result.intents.map((i) => {
                  const winner = result.intent?.id === i.id;
                  return (
                    <li key={i.id} className={winner ? "" : "text-subtle"}>
                      <span className="font-mono">#{i.name}</span> <span className="font-mono text-xs tabular-nums">{i.confidence.toFixed(2)}</span>
                      <span className="text-muted-foreground"> · {i.matched.join(", ")}</span>
                      {!winner && i === result.intents[0] && <span className="text-muted-foreground"> · below threshold</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className={h3}>Entities</h3>
            {Object.keys(result.entities).length === 0 ? (
              <p className="text-sm text-subtle">No order ID, email, phone, date, price, product, plan, category or location found</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {Object.entries(result.entities).map(([kind, values]) => (
                  <div key={kind} className="contents">
                    <dt className="text-muted-foreground">{kind}</dt>
                    <dd>{values.join(", ")}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section>
            <h3 className={h3}>Search results</h3>
            {result.results.length === 0 && <p className="text-sm text-subtle">Nothing in this chatbot’s content shares a word with the question</p>}
            <ol className="flex flex-col gap-2">
              {result.results.map((r, i) => {
                const winner = i === 0 && (result.via === "search" || result.via === "intent_fallback");
                return (
                  <Collapsible key={`${r.type}-${r.id}`} asChild open={open === i} onOpenChange={(o) => setOpen(o ? i : null)}>
                    <li>
                      <CollapsibleTrigger className="flex w-full justify-between gap-3 rounded-sm py-0.5 text-left text-sm">
                        <span className={cn("truncate", !winner && "text-subtle")}>{r.title}</span>
                        <span className="font-mono text-xs tabular-nums">{r.score.toFixed(2)}</span>
                      </CollapsibleTrigger>
                      <Progress value={Math.round(r.score * 100)} aria-label={`Score ${r.score.toFixed(2)}`} className={cn("mt-1", winner ? "[&>*]:bg-brand" : "[&>*]:bg-foreground/25")} />
                      <CollapsibleContent className="flex flex-col gap-1.5 pt-2 pb-1 text-sm">
                        <div className="text-xs text-muted-foreground">{r.type === "faq" ? "FAQ" : "Document section"}{r.category ? ` · ${r.category}` : ""}</div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                          {SIGNAL_LABELS.map(([k, label]) => (
                            <div key={k} className="contents">
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-mono text-xs leading-5 tabular-nums">{r.signals[k].toFixed(2)}</dd>
                            </div>
                          ))}
                        </dl>
                        {r.matched.length > 0 && <div><span className="text-muted-foreground">Matched </span>{r.matched.join(", ")}</div>}
                        {r.boost > 0 && <div><span className="text-muted-foreground">Intent tag boost </span><span className="font-mono text-xs">+{r.boost.toFixed(2)}</span></div>}
                      </CollapsibleContent>
                    </li>
                  </Collapsible>
                );
              })}
            </ol>
          </section>

          {result.related.length > 0 && (
            <section>
              <h3 className={h3}>{result.found && !result.clarification ? "Related" : "Did you mean"}</h3>
              <div className="flex flex-wrap gap-1.5">
                {result.related.map((r) => (
                  <Button key={r.id} type="button" variant="outline" size="sm" className="h-auto py-1 text-left font-normal whitespace-normal" onClick={() => ask(r.question)}>{r.question}</Button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

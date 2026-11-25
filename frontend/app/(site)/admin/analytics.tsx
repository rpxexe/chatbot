"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, type Category, type Intent, type Token } from "./api";
import { FaqForm } from "./faqs";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ItemCard } from "./ui";

type Asked = { key: string; question: string; count: number; lastAsked: string; matched?: string | null };
type Report = {
  days: number;
  totals: { conversations: number; questions: number; answered: number; lowConfidence: number; unanswered: number };
  topics: { topic: string; count: number }[];
  articles: { type: "faq" | "document"; id: number; title: string; count: number }[];
  intents: { intent: string; count: number }[];
  unanswered: Asked[];
  lowConfidence: Asked[];
};

type Props = { token: Token; kbId: number; categories: Category[]; intents: Intent[]; version: number; onChange: () => void; onError: (e: unknown) => void };

const RANGES = [7, 30, 90] as const;
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function AnalyticsPanel({ token, kbId, categories, intents, version, onChange, onError }: Props) {
  const [days, setDays] = useState<number>(30);
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(() => {
    api<Report>(token, `/kbs/${kbId}/analytics?days=${days}`).then(setReport).catch(onError);
  }, [token, kbId, days, onError]);
  useEffect(load, [load, version]);

  async function review(key: string) {
    try { await api(token, `/kbs/${kbId}/analytics/reviewed`, "POST", { key }); load(); } catch (e) { onError(e); }
  }

  if (!report) return <p className="text-muted-foreground">Loading</p>;
  const t = report.totals;
  const list = { token, kbId, categories, intents, onReview: review, onChange, onError };

  return (
    <div className="flex flex-col gap-8">
      <ToggleGroup type="single" variant="outline" spacing={0} className="self-start bg-card" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} aria-label="Time range">
        {RANGES.map((d) => <ToggleGroupItem key={d} value={String(d)} className="px-3">Last {d} days</ToggleGroupItem>)}
      </ToggleGroup>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Ledger totals={t} />
        <Card className="justify-center gap-0 divide-y px-6 py-0">
          <Stat label="Conversations" value={t.conversations} />
          <Stat label="Questions asked" value={t.questions} />
        </Card>
      </div>

      <section aria-labelledby="unanswered-h">
        <SectionHead id="unanswered-h" title="Questions the chatbot couldn’t answer" count={report.unanswered.length}>
          Add an FAQ for each one, or dismiss it. Both remove it from this list
        </SectionHead>
        <AskedList items={report.unanswered} empty="No unanswered questions in this period" {...list} />
      </section>

      <section aria-labelledby="low-h">
        <SectionHead id="low-h" title="Answered with a clarification" count={report.lowConfidence.length}>
          An FAQ worded like the visitor’s question makes the next answer confident
        </SectionHead>
        <AskedList items={report.lowConfidence} empty="No low-confidence answers in this period" {...list} />
      </section>

      <div className="grid gap-8 md:grid-cols-3">
        <Ranking title="Most searched topics" rows={report.topics.map((r) => ({ label: r.topic, count: r.count }))} empty="No questions yet" />
        <Ranking title="Most matched articles" rows={report.articles.map((r) => ({ label: r.title, note: r.type === "faq" ? "FAQ" : "Document", count: r.count }))} empty="No answers given yet" />
        <Ranking title="Popular intents" rows={report.intents.map((r) => ({ label: r.intent, count: r.count }))} empty="No intents detected yet" />
      </div>
    </div>
  );
}

/**
 * Where every question in the period ended up: answered from the content (the accent), answered with a clarification,
 * or not answered. One stacked bar, because the three parts make up the whole.
 */
function Ledger({ totals: t }: { totals: Report["totals"] }) {
  const parts = [
    { label: "Answered", value: t.answered, color: "bg-brand" },
    { label: "With clarification", value: t.lowConfidence, color: "bg-chart-2" },
    { label: "Unanswered", value: t.unanswered, color: "bg-chart-3" },
  ];
  return (
    <Card className="gap-6 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-subtle">Answered from your content</p>
          <p className="mt-2 text-4xl font-medium tabular-nums">{pct(t.answered, t.questions)}</p>
        </div>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">{t.questions.toLocaleString()} questions</p>
      </div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-[4px] bg-muted" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {t.questions > 0 && parts.map((p) => p.value > 0 && (
          <span key={p.label} className={cn("h-full", p.color)} style={{ width: `${(p.value / t.questions) * 100}%` }} />
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-4">
        {parts.map((p) => (
          <div key={p.label}>
            <dt className="flex items-center gap-2 text-sm text-subtle"><span className={cn("size-2 shrink-0 rounded-full", p.color)} aria-hidden="true" />{p.label}</dt>
            <dd className="mt-1 font-mono text-sm tabular-nums">{p.value.toLocaleString()} <span className="text-muted-foreground">· {pct(p.value, t.questions)}</span></dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-5">
      <p className="text-sm text-subtle">{label}</p>
      <p className="mt-2 text-3xl font-medium tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function SectionHead({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="flex items-baseline gap-2 font-medium">
        {title}
        {count > 0 && <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      <p className="mt-0.5 text-sm text-subtle">{children}</p>
    </div>
  );
}

/** Top-N list: one series, so one neutral tone; every bar keeps its count as text. */
function Ranking({ title, rows, empty }: { title: string; rows: { label: string; note?: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section>
      <h2 className="mb-3 font-medium">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ol className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={`${r.label}-${r.note ?? ""}`} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate" title={r.label}>{r.label}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}</span>
                <span className="font-mono text-xs text-subtle tabular-nums">{r.count}</span>
              </div>
              <Progress value={(r.count / max) * 100} aria-hidden="true" className="mt-1.5 [&>*]:bg-foreground/35" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AskedList({ items, empty, token, kbId, categories, intents, onReview, onChange, onError }: {
  items: Asked[]; empty: string; token: Token; kbId: number; categories: Category[]; intents: Intent[];
  onReview: (key: string) => void; onChange: () => void; onError: (e: unknown) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((q) => (
        <ItemCard key={q.key}>
            {adding === q.key ? (
              <FaqForm
                {...{ token, kbId, categories, intents, onError }}
                initialQuestion={q.question}
                onDone={() => { setAdding(null); onReview(q.key); onChange(); }}
                onCancel={() => setAdding(null)}
              />
            ) : (
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">“{q.question}”</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-mono tabular-nums">Asked {q.count}×</span> · last {when(q.lastAsked)}
                    {q.matched && <> · matched “{q.matched}”</>}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setAdding(q.key)}><Plus className="size-3.5" strokeWidth={1.75} aria-hidden="true" />Add as FAQ</Button>
                  <Button size="sm" variant="ghost" className="text-subtle" onClick={() => onReview(q.key)}>Dismiss</Button>
                </div>
              </div>
            )}
        </ItemCard>
      ))}
    </ul>
  );
}

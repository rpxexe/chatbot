"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, type Category, type Intent } from "./api";
import { FaqForm } from "./faqs";
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

type Props = { token: string; kbId: number; categories: Category[]; intents: Intent[]; version: number; onChange: () => void; onError: (e: unknown) => void };

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

  if (!report) return <p className="text-muted-foreground">Loading…</p>;
  const t = report.totals;
  const list = { token, kbId, categories, intents, onReview: review, onChange, onError };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold">Analytics</h2>
        <ToggleGroup type="single" variant="outline" spacing={0} value={String(days)} onValueChange={(v) => v && setDays(Number(v))} aria-label="Time range">
          {RANGES.map((d) => <ToggleGroupItem key={d} value={String(d)}>Last {d} days</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Conversations" value={t.conversations} />
        <Stat label="Questions asked" value={t.questions} />
        <Stat label="Answered" value={t.answered} note={pct(t.answered, t.questions)} />
        <Stat label="Low confidence" value={t.lowConfidence} note={`${pct(t.lowConfidence, t.questions)} · answered + clarification`} />
        <Stat label="Unanswered" value={t.unanswered} note={pct(t.unanswered, t.questions)} />
      </dl>

      <section aria-labelledby="unanswered-h">
        <h3 id="unanswered-h" className="font-semibold">Questions the chatbot couldn’t answer</h3>
        <p className="mb-2 text-sm text-muted-foreground">Add an FAQ for each one, or dismiss it. Both remove it from this list.</p>
        <AskedList items={report.unanswered} empty="No unanswered questions in this period." {...list} />
      </section>

      <section aria-labelledby="low-h">
        <h3 id="low-h" className="font-semibold">Low-confidence questions</h3>
        <p className="mb-2 text-sm text-muted-foreground">Answered with a clarification. An FAQ worded like the visitor’s question makes the next answer confident.</p>
        <AskedList items={report.lowConfidence} empty="No low-confidence answers in this period." {...list} />
      </section>

      <div className="grid gap-6 md:grid-cols-3">
        <Ranking title="Most searched topics" rows={report.topics.map((r) => ({ label: r.topic, count: r.count }))} empty="No questions yet." />
        <Ranking title="Most matched articles" rows={report.articles.map((r) => ({ label: r.title, note: r.type === "faq" ? "FAQ" : "Document", count: r.count }))} empty="No answers given yet." />
        <Ranking title="Popular intents" rows={report.intents.map((r) => ({ label: r.intent, count: r.count }))} empty="No intents detected yet." />
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card size="sm" className="gap-1 px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
      {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
    </Card>
  );
}

/** Top-N bar list: one series, so one hue and no legend; every bar keeps its count as text. */
function Ranking({ title, rows, empty }: { title: string; rows: { label: string; note?: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <ol className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={`${r.label}-${r.note ?? ""}`} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate" title={r.label}>{r.label}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}</span>
                <span className="tabular-nums">{r.count}</span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
                <span className="block h-full rounded-r-sm bg-primary" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AskedList({ items, empty, token, kbId, categories, intents, onReview, onChange, onError }: {
  items: Asked[]; empty: string; token: string; kbId: number; categories: Category[]; intents: Intent[];
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
                  <p className="text-sm text-muted-foreground">
                    Asked {q.count}× · last {when(q.lastAsked)}
                    {q.matched && <> · matched “{q.matched}”</>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setAdding(q.key)}>Add as FAQ</Button>
                  <Button size="sm" variant="outline" onClick={() => onReview(q.key)}>Dismiss</Button>
                </div>
              </div>
            )}
        </ItemCard>
      ))}
    </ul>
  );
}

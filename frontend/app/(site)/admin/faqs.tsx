"use client";
import { toast } from "sonner";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, splitKeywords, type Category, type Faq, type Intent, type Token } from "./api";
import { IntentSelect } from "./intents";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { EnabledSwitch, Hint, ItemCard, Meta, RowAction } from "./ui";

type Props = { token: Token; kbId: number; categories: Category[]; intents: Intent[]; version: number; onChange: () => void; onError: (e: unknown) => void };

// Radix Select forbids "" as an item value.
const ALL = "__all__";

export function FaqsPanel({ token, kbId, categories, intents, version, onChange, onError }: Props) {
  const [faqs, setFaqs] = useState<Faq[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Faq | "new" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (cat) params.set("category", cat);
    const t = setTimeout(() => api<Faq[]>(token, `/kbs/${kbId}/faqs?${params}`).then(setFaqs).catch(onError), 200);
    return () => clearTimeout(t);
  }, [token, kbId, q, cat, version, onError]);

  async function toggle(f: Faq) {
    try { await api(token, `/faqs/${f.id}`, "PATCH", { enabled: !f.enabled }); onChange(); } catch (e) { onError(e); }
  }
  async function remove(f: Faq) {
    if (!confirm(`Delete FAQ "${f.question}"?`)) return;
    try { await api(token, `/faqs/${f.id}`, "DELETE"); toast.success("FAQ deleted"); onChange(); } catch (e) { onError(e); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="faq-q" className="sr-only">Search FAQs</Label>
        <InputGroup className="min-w-40 flex-1 bg-card dark:bg-card">
          <InputGroupInput id="faq-q" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <InputGroupAddon><Search strokeWidth={1.75} aria-hidden="true" /></InputGroupAddon>
        </InputGroup>
        <Select value={cat || ALL} onValueChange={(v) => setCat(v === ALL ? "" : v)}>
          <SelectTrigger id="faq-cat" aria-label="Filter by category" className="min-w-40 bg-card"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setEditing("new")}><Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />Add FAQ</Button>
      </div>

      {editing === "new" && (
        <Card><CardContent><FaqForm {...{ token, kbId, categories, intents, onError }} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} /></CardContent></Card>
      )}

      {faqs?.length === 0 && <p className="text-muted-foreground">No FAQs{q || cat ? " match" : " yet"}</p>}
      {faqs && faqs.length > 0 && <Meta className="font-mono tabular-nums">{faqs.length} {faqs.length === 1 ? "FAQ" : "FAQs"}</Meta>}
      <ul className="flex flex-col gap-2">
        {faqs?.map((f) => (
          <ItemCard key={f.id} enabled={f.enabled}>
            {editing !== "new" && editing?.id === f.id ? (
              <FaqForm {...{ token, kbId, categories, intents, onError }} faq={f} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="item-title font-medium">{f.question}</h3>
                    <p className="mt-1 line-clamp-2 text-subtle">{f.answer}</p>
                  </div>
                  <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
                    <EnabledSwitch checked={f.enabled} onChange={() => toggle(f)} />
                    <RowAction icon={Pencil} label="Edit" onClick={() => setEditing(f)} />
                    <RowAction icon={Trash2} label="Delete" danger onClick={() => remove(f)} />
                  </div>
                </div>
                {(f.category || f.intent || f.keywords.length > 0) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {f.category && <Badge variant="secondary" className="font-normal">{f.category}</Badge>}
                    {f.intent && <Meta className="font-mono">#{f.intent}</Meta>}
                    {f.keywords.length > 0 && <Meta>{f.keywords.join(" · ")}</Meta>}
                  </div>
                )}
              </>
            )}
          </ItemCard>
        ))}
      </ul>
    </div>
  );
}

/** Edits `faq`, or adds a new FAQ (optionally starting from `initialQuestion`, e.g. an unanswered visitor question). */
export function FaqForm({ token, kbId, categories, intents, faq, initialQuestion, onDone, onCancel, onError }: {
  token: Token; kbId: number; categories: Category[]; intents: Intent[]; faq?: Faq; initialQuestion?: string; onDone: () => void; onCancel: () => void; onError: (e: unknown) => void;
}) {
  const [question, setQuestion] = useState(faq?.question ?? initialQuestion ?? "");
  const [answer, setAnswer] = useState(faq?.answer ?? "");
  const [category, setCategory] = useState(faq?.category ?? "");
  const [keywords, setKeywords] = useState(faq?.keywords.join(", ") ?? "");
  const [enabled, setEnabled] = useState(faq?.enabled ?? true);
  const [intentId, setIntentId] = useState<number | null>(faq?.intent_id ?? null);
  const [busy, setBusy] = useState(false);
  const uid = useId().replace(/:/g, "");
  // Unique per form: the analytics tab can show this form next to the FAQs tab's own "new FAQ" form.
  const id = faq ? `faq-${faq.id}` : initialQuestion ? `faq-from-${uid}` : "faq-new";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { question, answer, category: category.trim() || null, keywords: splitKeywords(keywords), enabled, intent_id: intentId };
    try {
      if (faq) await api(token, `/faqs/${faq.id}`, "PATCH", body);
      else await api(token, `/kbs/${kbId}/faqs`, "POST", body);
      toast.success(faq ? "FAQ saved" : "FAQ added");
      onDone();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={save}>
      <Label htmlFor={`${id}-q`}>Question</Label>
      <Input id={`${id}-q`} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} required autoFocus />
      <Label htmlFor={`${id}-a`}>Answer</Label>
      <Textarea id={`${id}-a`} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={10000} rows={4} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-c`}>Category</Label>
          <Input id={`${id}-c`} list="category-list" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} placeholder="e.g. Billing" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-k`}>Keywords <Hint>(comma-separated)</Hint></Label>
          <Input id={`${id}-k`} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="refund, money back" />
        </div>
      </div>
      <Label htmlFor={`${id}-i`}>Intent <Hint>(boosts this FAQ when the intent is detected)</Hint></Label>
      <IntentSelect id={`${id}-i`} intents={intents} value={intentId} onChange={setIntentId} />
      <datalist id="category-list">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <EnabledSwitch checked={enabled} onChange={setEnabled} label="Enabled" />
      <div className="flex gap-2">
        <Button disabled={busy}>{faq ? "Save" : "Add FAQ"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

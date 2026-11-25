"use client";
import { toast } from "sonner";

import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { api, splitKeywords, type Intent, type Token } from "./api";
import { Pencil, Trash2 } from "lucide-react";
import { EnabledSwitch, Hint, ItemCard, RowAction } from "./ui";

type Props = { token: Token; kbId: number; intents: Intent[]; onChange: () => void; onError: (e: unknown) => void };

export function IntentsPanel({ token, kbId, intents, onChange, onError }: Props) {
  const [editing, setEditing] = useState<Intent | "new" | null>(null);

  async function toggle(i: Intent) {
    try { await api(token, `/intents/${i.id}`, "PATCH", { enabled: !i.enabled }); onChange(); } catch (e) { onError(e); }
  }
  async function remove(i: Intent) {
    const tagged = i.faq_count + i.document_count;
    if (!confirm(`Delete intent "${i.name}"?${tagged ? ` ${tagged} tagged FAQs/documents keep their content but lose the tag.` : ""}`)) return;
    try { await api(token, `/intents/${i.id}`, "DELETE"); toast.success(`Intent “${i.name}” deleted`); onChange(); } catch (e) { onError(e); }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        An intent is detected when the question contains one of its patterns. Matching ignores word endings and allows one typo in longer words.
        If an intent has a fixed response, that response is used when the intent explains most of the question.
        Otherwise, FAQs and documents tagged with the intent are ranked higher.
      </p>
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>Add intent</Button>
      </div>
      {editing === "new" && (
        <Card><CardContent><IntentForm {...{ token, kbId, onError }} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} /></CardContent></Card>
      )}
      <ul className="flex flex-col gap-2.5">
        {intents.map((i) => (
          <ItemCard key={i.id} enabled={i.enabled}>
            {editing !== "new" && editing?.id === i.id ? (
              <IntentForm {...{ token, kbId, onError }} intent={i} onDone={() => { setEditing(null); onChange(); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <strong className="font-medium">{i.name}</strong>
                  <EnabledSwitch checked={i.enabled} onChange={() => toggle(i)} />
                </div>
                <div className="flex flex-wrap gap-1">{i.patterns.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}</div>
                {i.response && <p className="line-clamp-3"><span className="text-muted-foreground">Responds: </span>{i.response}</p>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{i.faq_count} FAQs · {i.document_count} documents tagged</span>
                  <span className="flex-1" />
                  <RowAction icon={Pencil} label="Edit" onClick={() => setEditing(i)} />
                  <RowAction icon={Trash2} label="Delete" danger onClick={() => remove(i)} />
                </div>
              </>
            )}
          </ItemCard>
        ))}
      </ul>
    </div>
  );
}

function IntentForm({ token, kbId, intent, onDone, onCancel, onError }: {
  token: Token; kbId: number; intent?: Intent; onDone: () => void; onCancel: () => void; onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(intent?.name ?? "");
  const [patterns, setPatterns] = useState(intent?.patterns.join(", ") ?? "");
  const [response, setResponse] = useState(intent?.response ?? "");
  const [busy, setBusy] = useState(false);
  const id = intent ? `intent-${intent.id}` : "intent-new";

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { name, patterns: splitKeywords(patterns), response: response.trim() || null };
    try {
      if (intent) await api(token, `/intents/${intent.id}`, "PATCH", body);
      else await api(token, `/kbs/${kbId}/intents`, "POST", body);
      toast.success(intent ? "Intent saved" : "Intent added");
      onDone();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={save}>
      <Label htmlFor={`${id}-n`}>Name <Hint>(lowercase letters, digits, _ and -)</Hint></Label>
      <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value.toLowerCase())} pattern="[a-z0-9_\-]+" maxLength={50} required autoFocus />
      <Label htmlFor={`${id}-p`}>Patterns <Hint>(comma-separated words or phrases)</Hint></Label>
      <Textarea id={`${id}-p`} value={patterns} onChange={(e) => setPatterns(e.target.value)} rows={2} placeholder="price, pricing, cost, how much, fee" required />
      <Label htmlFor={`${id}-r`}>Fixed response <Hint>(optional, e.g. your address for “location”)</Hint></Label>
      <Textarea id={`${id}-r`} value={response} onChange={(e) => setResponse(e.target.value)} rows={2} maxLength={5000} />
      <div className="flex gap-2">
        <Button disabled={busy || !splitKeywords(patterns).length}>{intent ? "Save" : "Add intent"}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

// Radix Select forbids "" as an item value, so "no intent" uses a sentinel.
const NONE = "none";

/** Intent picker used on FAQs and documents. */
export function IntentSelect({ id, intents, value, onChange, className, label }: {
  id: string; intents: Intent[]; value: number | null; onChange: (v: number | null) => void; className?: string; label?: string;
}) {
  return (
    <Select value={value == null ? NONE : String(value)} onValueChange={(v) => onChange(v === NONE ? null : Number(v))}>
      <SelectTrigger id={id} aria-label={label} className={cn("w-full", className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No intent</SelectItem>
        {intents.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}{i.enabled ? "" : " (disabled)"}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

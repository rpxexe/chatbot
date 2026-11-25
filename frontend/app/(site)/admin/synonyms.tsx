"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, splitKeywords, type Token } from "./api";
import { Pencil, Trash2 } from "lucide-react";
import { ItemCard, RowAction } from "./ui";

type Props = { token: Token; kbId: number; version: number; onChange: () => void; onError: (e: unknown) => void };
type Group = { id: number; terms: string[] };

export function SynonymsPanel({ token, kbId, version, onChange, onError }: Props) {
  const [custom, setCustom] = useState<Group[] | null>(null);
  const [builtin, setBuiltin] = useState<string[][]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    api<{ custom: Group[]; builtin: string[][] }>(token, `/kbs/${kbId}/synonyms`)
      .then((d) => { setCustom(d.custom); setBuiltin(d.builtin); })
      .catch(onError);
  }, [token, kbId, version, onError]);

  async function add(e: FormEvent) {
    e.preventDefault();
    try { await api(token, `/kbs/${kbId}/synonyms`, "POST", { terms: splitKeywords(draft) }); setDraft(""); onChange(); } catch (err) { onError(err); }
  }
  async function save(g: Group) {
    try { await api(token, `/synonyms/${g.id}`, "PATCH", { terms: splitKeywords(editText) }); setEditing(null); onChange(); } catch (err) { onError(err); }
  }
  async function remove(g: Group) {
    if (!confirm(`Delete synonym group "${g.terms.join(", ")}"?`)) return;
    try { await api(token, `/synonyms/${g.id}`, "DELETE"); onChange(); } catch (err) { onError(err); }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Words in a group are treated as interchangeable when matching questions. A synonym match counts a little less than the exact word.
        Phrases work too, for example “money back, refund”.
      </p>
      <Card>
        <CardContent>
          <form className="flex gap-2" onSubmit={add}>
            <Label htmlFor="syn-new" className="sr-only">New synonym group</Label>
            <Input id="syn-new" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="staff, employee, team member" />
            <Button disabled={splitKeywords(draft).length < 2}>Add group</Button>
          </form>
        </CardContent>
      </Card>

      <h3 className="mt-2 text-sm font-medium">This knowledge base</h3>
      {custom?.length === 0 && <p className="text-sm text-muted-foreground">No custom groups yet.</p>}
      <ul className="flex flex-col gap-2.5">
        {custom?.map((g) => (
          <ItemCard key={g.id}>
            {editing === g.id ? (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save(g); }}>
                <Label htmlFor={`syn-${g.id}`} className="sr-only">Terms</Label>
                <Input id={`syn-${g.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
                <Button disabled={splitKeywords(editText).length < 2}>Save</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {g.terms.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                <span className="flex-1" />
                <RowAction icon={Pencil} label="Edit" onClick={() => { setEditing(g.id); setEditText(g.terms.join(", ")); }} />
                <RowAction icon={Trash2} label="Delete" danger onClick={() => remove(g)} />
              </div>
            )}
          </ItemCard>
        ))}
      </ul>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group -ml-2.5">
            <ChevronRightIcon className="transition-transform group-data-[state=open]:rotate-90" />
            Built-in groups ({builtin.length}), applied to every knowledge base
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {builtin.map((g, i) => <li key={i}>{g.join(", ")}</li>)}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

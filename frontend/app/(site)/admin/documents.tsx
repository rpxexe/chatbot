"use client";
import { toast } from "sonner";

import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, download, type Category, type Doc, type Intent, type Section, type Token } from "./api";
import { IntentSelect } from "./intents";
import { Download, Folder, Trash2 } from "lucide-react";
import { EnabledSwitch, Hint, ItemCard, Meta, RowAction } from "./ui";

type Props = { token: Token; kbId: number; categories: Category[]; intents: Intent[]; version: number; onChange: () => void; onError: (e: unknown) => void };
type Mode = "file" | "url" | "text";

export function DocumentsPanel({ token, kbId, categories, intents, version, onChange, onError }: Props) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    api<Doc[]>(token, `/kbs/${kbId}/documents`).then(setDocs).catch(onError);
  }, [token, kbId, version, onError]);

  async function patch(d: Doc, body: object) {
    try { await api(token, `/documents/${d.id}`, "PATCH", body); onChange(); } catch (e) { onError(e); }
  }
  async function remove(d: Doc) {
    if (!confirm(`Delete "${d.title}" and all its sections?`)) return;
    try { await api(token, `/documents/${d.id}`, "DELETE"); toast.success(`Deleted “${d.title}”`); onChange(); } catch (e) { onError(e); }
  }
  function recategorize(d: Doc) {
    const name = prompt(`Category for "${d.title}" (leave empty to clear):`, d.category ?? "");
    if (name !== null) patch(d, { category: name.trim() || null });
  }

  return (
    <div className="flex flex-col gap-3">
      <AddContent {...{ token, kbId, categories, onChange, onError }} />
      {docs?.length === 0 && <p className="text-muted-foreground">No documents yet</p>}
      <ul className="flex flex-col gap-2">
        {docs?.map((d) => (
          <ItemCard key={d.id} enabled={d.enabled}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="item-title font-medium">{d.title}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Meta className="font-mono">{d.source_type}</Meta>
                  {d.source_type === "url" && d.source_name
                    ? <a href={d.source_name} target="_blank" rel="noreferrer" className="max-w-72 truncate text-xs text-subtle underline underline-offset-4 hover:text-foreground">{d.source_name}</a>
                    : d.source_name !== d.title && <Meta className="max-w-72 truncate">{d.source_name}</Meta>}
                  <Meta className="font-mono tabular-nums">{d.section_count} {d.section_count === 1 ? "section" : "sections"}</Meta>
                  {d.category && <Badge variant="secondary" className="font-normal">{d.category}</Badge>}
                </div>
              </div>
              <div className="-mt-1 -mr-2 flex shrink-0 items-center gap-1">
                <EnabledSwitch checked={d.enabled} onChange={() => patch(d, { enabled: !d.enabled })} />
                {d.has_file && <RowAction icon={Download} label="Download original" onClick={() => download(token, `/documents/${d.id}/file`, d.source_name ?? d.title).catch(onError)} />}
                <RowAction icon={Folder} label="Change category" onClick={() => recategorize(d)} />
                <RowAction icon={Trash2} label="Delete" danger onClick={() => remove(d)} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <IntentSelect id={`doc-intent-${d.id}`} label={`Intent for ${d.title}`} className="h-7 w-auto text-xs" intents={intents} value={d.intent_id} onChange={(v) => patch(d, { intent_id: v })} />
              <Button variant="ghost" size="sm" className="text-subtle" onClick={() => setOpen(open === d.id ? null : d.id)} aria-expanded={open === d.id}>{open === d.id ? "Hide sections" : "Show sections"}</Button>
            </div>
            {open === d.id && <Sections token={token} docId={d.id} onChange={onChange} onError={onError} />}
          </ItemCard>
        ))}
      </ul>
    </div>
  );
}

function AddContent({ token, kbId, categories, onChange, onError }: Omit<Props, "version" | "intents">) {
  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const cat = category.trim() || null;
    try {
      let r;
      if (mode === "file") {
        const fd = new FormData();
        fd.append("file", file!);
        if (cat) fd.append("category", cat);
        r = await api(token, `/kbs/${kbId}/upload`, "POST", fd);
      } else if (mode === "url") {
        r = await api(token, `/kbs/${kbId}/import-url`, "POST", { url, category: cat });
      } else {
        r = await api(token, `/kbs/${kbId}/documents`, "POST", { title, text, category: cat });
      }
      toast.success(r.type === "faqs" ? `Imported ${r.count} FAQs` : `Added “${r.title}”`, r.type === "faqs" ? undefined : { description: `${r.sections} searchable section${r.sections === 1 ? "" : "s"}` });
      setFile(null); setUrl(""); setTitle(""); setText("");
      (e.target as HTMLFormElement).reset();
      onChange();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <ToggleGroup type="single" variant="outline" spacing={0} value={mode} onValueChange={(v) => v && setMode(v as Mode)} aria-label="Content source" className="mb-1">
            <ToggleGroupItem value="file">Upload file</ToggleGroupItem>
            <ToggleGroupItem value="url">Website URL</ToggleGroupItem>
            <ToggleGroupItem value="text">Write text</ToggleGroupItem>
          </ToggleGroup>
          {mode === "file" && (
            <>
              <Label htmlFor="doc-file" className="block leading-normal">File <Hint>PDF, DOCX, TXT, Markdown or CSV, up to 20 MB. A CSV with question and answer columns imports as FAQs.</Hint></Label>
              <Input id="doc-file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </>
          )}
          {mode === "url" && (
            <>
              <Label htmlFor="doc-url">Page URL</Label>
              <Input id="doc-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/help/returns" required />
            </>
          )}
          {mode === "text" && (
            <>
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
              <Label htmlFor="doc-text">Text <Hint>Markdown headings (## Heading) split it into sections.</Hint></Label>
              <Textarea id="doc-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} required />
            </>
          )}
          <Label htmlFor="doc-cat">Category <Hint>(optional)</Hint></Label>
          <Input id="doc-cat" list="doc-category-list" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />
          <datalist id="doc-category-list">{categories.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busy}>{busy ? "Processing" : "Add to knowledge base"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Sections({ token, docId, onChange, onError }: { token: Token; docId: number; onChange: () => void; onError: (e: unknown) => void }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    api<{ sections: Section[] }>(token, `/documents/${docId}`).then((d) => setSections(d.sections)).catch(onError);
  }, [token, docId, rev, onError]);

  async function save(s: Section, heading: string, body: string) {
    try { await api(token, `/sections/${s.id}`, "PATCH", { heading, body }); toast.success("Section saved"); setRev((r) => r + 1); } catch (e) { onError(e); }
  }
  async function remove(s: Section) {
    if (!confirm("Delete this section?")) return;
    try { await api(token, `/sections/${s.id}`, "DELETE"); toast.success("Section deleted"); setRev((r) => r + 1); onChange(); } catch (e) { onError(e); }
  }

  if (!sections) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <ol className="mt-3 flex list-decimal flex-col gap-4 pl-5">
      {sections.map((s) => <SectionEditor key={`${s.id}-${s.body.length}`} s={s} onSave={save} onDelete={remove} />)}
    </ol>
  );
}

function SectionEditor({ s, onSave, onDelete }: { s: Section; onSave: (s: Section, h: string, b: string) => void; onDelete: (s: Section) => void }) {
  const [heading, setHeading] = useState(s.heading);
  const [body, setBody] = useState(s.body);
  const dirty = heading !== s.heading || body !== s.body;
  return (
    <li className="flex flex-col gap-2">
      <Label className="sr-only" htmlFor={`sh-${s.id}`}>Section heading</Label>
      <Input id={`sh-${s.id}`} value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="(no heading)" />
      <Label className="sr-only" htmlFor={`sb-${s.id}`}>Section text</Label>
      <Textarea id={`sb-${s.id}`} className="field-sizing-fixed" value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(10, Math.ceil(body.length / 90) + 1)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!dirty || !body.trim()} onClick={() => onSave(s, heading, body)}>Save</Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(s)}>Delete section</Button>
      </div>
    </li>
  );
}

"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, type Category, type Intent, type Kb } from "./api";
import { IntentsPanel } from "./intents";
import { FaqsPanel } from "./faqs";
import { DocumentsPanel } from "./documents";
import { CategoriesPanel } from "./categories";
import { PreviewPanel } from "./preview";
import { SynonymsPanel } from "./synonyms";
import { AnalyticsPanel } from "./analytics";
import { HandoffPanel } from "./handoff";

const TOKEN_KEY = "kb-admin-token";
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch {} },
};

type Tab = "faqs" | "documents" | "categories" | "intents" | "synonyms" | "analytics" | "handoff";
const TAB_LABEL: Record<Tab, string> = { faqs: "FAQs", documents: "Documents", categories: "Categories", intents: "Intents", synonyms: "Synonyms", analytics: "Analytics", handoff: "Handoff" };

export default function Admin() {
  const [token, setToken] = useState("");
  const [kbs, setKbs] = useState<Kb[] | null>(null);
  const [kbId, setKbId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [tab, setTab] = useState<Tab>("faqs");
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { store.set(""); setToken(""); setKbs(null); }
    setError((e as Error).message);
  }, []);

  useEffect(() => { setToken(store.get()); }, []);

  useEffect(() => {
    if (!token) return;
    api<Kb[]>(token, "/kbs")
      .then((list) => {
        setKbs(list);
        setKbId((cur) => (cur && list.some((k) => k.id === cur) ? cur : list[0]?.id ?? null));
      })
      .catch(fail);
  }, [token, version, fail]);

  useEffect(() => {
    if (!token || !kbId) return;
    api<Category[]>(token, `/kbs/${kbId}/categories`).then(setCategories).catch(fail);
    api<Intent[]>(token, `/kbs/${kbId}/intents`).then(setIntents).catch(fail);
  }, [token, kbId, version, fail]);

  if (!token) return <Login onToken={(t) => { store.set(t); setToken(t); setError(""); }} error={error} />;

  const kb = kbs?.find((k) => k.id === kbId) ?? null;
  const props = { token, kbId: kbId!, categories, intents, version, onChange: bump, onError: fail };

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Knowledge Base Admin</h1>
        <KbPicker token={token} kbs={kbs ?? []} kbId={kbId} onSelect={setKbId} onChange={bump} onError={fail} />
        <Button variant="link" onClick={() => { store.set(""); setToken(""); setKbs(null); }}>Sign out</Button>
      </header>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="text-destructive">{error}</AlertDescription>
          <AlertAction><Button variant="ghost" size="xs" onClick={() => setError("")}>Dismiss</Button></AlertAction>
        </Alert>
      )}
      {kbs && kbs.length === 0 && <p className="text-muted-foreground">Create a knowledge base to get started.</p>}
      {kb && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-w-0">
            <TabsList variant="line" className="mb-2 flex-wrap">
              {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
                const count = { faqs: kb.faq_count, documents: kb.document_count, categories: categories.length, intents: intents.length, synonyms: null, analytics: null, handoff: kb.open_tickets || null }[t];
                return <TabsTrigger key={t} value={t}>{TAB_LABEL[t]}{count != null ? ` (${count})` : ""}</TabsTrigger>;
              })}
            </TabsList>
            <TabsContent value="faqs"><FaqsPanel {...props} /></TabsContent>
            <TabsContent value="documents"><DocumentsPanel {...props} /></TabsContent>
            <TabsContent value="categories"><CategoriesPanel {...props} /></TabsContent>
            <TabsContent value="intents"><IntentsPanel {...props} /></TabsContent>
            <TabsContent value="synonyms"><SynonymsPanel {...props} /></TabsContent>
            <TabsContent value="analytics"><AnalyticsPanel {...props} /></TabsContent>
            <TabsContent value="handoff"><HandoffPanel token={token} kb={kb} onChange={bump} onError={fail} /></TabsContent>
          </Tabs>
          <Card className="lg:sticky lg:top-4">
            <CardContent><PreviewPanel kb={kb} /></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Login({ onToken, error }: { onToken: (t: string) => void; error: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(error);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(value.trim(), "/kbs");
      onToken(value.trim());
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto mt-[15vh] max-w-sm p-4">
      <h1 className="mb-4 text-xl font-semibold">Knowledge Base Admin</h1>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor="token">Admin token</Label>
        <Input id="token" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" required />
        {msg && <Alert variant="destructive"><AlertDescription className="text-destructive">{msg}</AlertDescription></Alert>}
        <Button disabled={busy || !value.trim()}>Sign in</Button>
      </form>
    </main>
  );
}

function KbPicker({ token, kbs, kbId, onSelect, onChange, onError }: {
  token: string; kbs: Kb[]; kbId: number | null; onSelect: (id: number) => void; onChange: () => void; onError: (e: unknown) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const kb = kbs.find((k) => k.id === kbId);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { id } = await api(token, "/kbs", "POST", { name });
      setName(""); setCreating(false); onSelect(id); onChange();
    } catch (err) { onError(err); }
  }
  async function remove() {
    if (!kb || !confirm(`Delete "${kb.name}" and ALL its FAQs, documents, categories, intents and synonyms? This cannot be undone.`)) return;
    try { await api(token, `/kbs/${kb.id}`, "DELETE"); onChange(); } catch (err) { onError(err); }
  }

  if (creating) {
    return (
      <form className="flex flex-wrap items-center gap-2" onSubmit={create}>
        <Label htmlFor="kb-name" className="sr-only">New knowledge base name</Label>
        <Input id="kb-name" className="w-56" value={name} onChange={(e) => setName(e.target.value)} placeholder="Knowledge base name" maxLength={100} autoFocus required />
        <Button>Create</Button>
        <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={kbId ? String(kbId) : ""} onValueChange={(v) => onSelect(Number(v))}>
        <SelectTrigger id="kb" aria-label="Knowledge base" className="min-w-48"><SelectValue placeholder="Knowledge base" /></SelectTrigger>
        <SelectContent>
          {kbs.map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.name} ({k.slug})</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" onClick={() => setCreating(true)}>New</Button>
      {kb && <Button variant="link" asChild><a href={`/?kb=${encodeURIComponent(kb.slug)}`} target="_blank" rel="noreferrer">Open chat</a></Button>}
      {kb && <Button variant="destructive" onClick={remove}>Delete</Button>}
    </div>
  );
}

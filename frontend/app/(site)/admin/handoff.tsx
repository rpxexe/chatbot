"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { api, type Handoff, type Kb, type Token } from "./api";
import { EnabledSwitch, Hint, ItemCard } from "./ui";

type TicketRow = {
  id: string; name: string | null; email: string | null; live: boolean; status: "open" | "closed";
  created_at: string; updated_at: string; last_message: string; last_author: "visitor" | "agent"; message_count: number;
};
type Message = { id: number; author: "visitor" | "agent"; body: string; createdAt: string };
type Ticket = Omit<TicketRow, "last_message" | "last_author" | "message_count"> & {
  messages: Message[]; conversation: { message: string; level: "high" | "medium" | "low"; created_at: string }[];
};
type Status = "open" | "closed" | "all";

type Props = { token: Token; kb: Kb; onChange: () => void; onError: (e: unknown) => void };

// Agents need to see live-chat messages without reloading.
const REFRESH_MS = 5000;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const LEVEL: Record<Ticket["conversation"][number]["level"], string> = { high: "answered", medium: "low confidence", low: "not answered" };

export function HandoffPanel({ token, kb, onChange, onError }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {/* Keyed by KB only: after a save the refetched settings equal the form, so no remount is needed. */}
      <Settings key={kb.id} token={token} kb={kb} onChange={onChange} onError={onError} />
      <Inbox token={token} kbId={kb.id} onChange={onChange} onError={onError} />
    </div>
  );
}

function Settings({ token, kb, onChange, onError }: Props) {
  const [h, setH] = useState<Handoff>(kb.handoff);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Handoff>) => { setH((cur) => ({ ...cur, ...patch })); setSaved(false); };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(token, `/kbs/${kb.id}`, "PATCH", { handoff: { ...h, ticket: !!h.ticket, live: !!h.live } });
      setSaved(true);
      onChange();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={save}>
          <div>
            <h2 className="font-medium">Talk to a person</h2>
            <p className="text-sm text-muted-foreground">
              Offered when the bot can’t answer, or when a visitor asks for a person (the <code>human_agent</code> intent).
              Leave everything empty to turn handoff off.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ho-email">Email</Label>
              <Input id="ho-email" type="email" value={h.email ?? ""} onChange={(e) => set({ email: e.target.value })} placeholder="support@example.com" maxLength={254} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ho-url">Contact form URL</Label>
              <Input id="ho-url" type="url" value={h.contactUrl ?? ""} onChange={(e) => set({ contactUrl: e.target.value })} placeholder="https://example.com/contact" maxLength={500} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ho-wa">WhatsApp number <Hint>(international)</Hint></Label>
              <Input id="ho-wa" type="tel" value={h.whatsapp ?? ""} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="+44 7700 900123" maxLength={30} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <EnabledSwitch checked={!!h.ticket} onChange={(v) => set({ ticket: v })} label="Leave a message: visitor sends a ticket with their email, you reply below" />
            <EnabledSwitch checked={!!h.live} onChange={(v) => set({ live: v })} label="Chat with an agent: you answer below while the visitor waits in the widget" />
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={busy}>Save</Button>
            {saved && <span className="text-sm text-muted-foreground" role="status">Saved.</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Inbox({ token, kbId, onChange, onError }: { token: Token; kbId: number; onChange: () => void; onError: (e: unknown) => void }) {
  const [status, setStatus] = useState<Status>("open");
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api<TicketRow[]>(token, `/kbs/${kbId}/tickets?status=${status}`).then(setRows).catch(onError);
  }, [token, kbId, status, onError]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section aria-labelledby="inbox-h" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="inbox-h" className="mr-auto font-medium">Conversations with your team</h2>
        <ToggleGroup type="single" variant="outline" spacing={0} value={status} onValueChange={(v) => v && setStatus(v as Status)} aria-label="Ticket status">
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {rows === null ? <p className="text-muted-foreground">Loading</p>
        : rows.length === 0 ? <p className="text-sm text-muted-foreground">No {status === "all" ? "" : `${status} `}conversations</p>
        : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <ItemCard key={r.id}>
                {openId === r.id ? (
                  <Thread id={r.id} token={token} onClose={() => setOpenId(null)} onChange={() => { load(); onChange(); }} onError={onError} />
                ) : (
                  <Button type="button" variant="ghost" className="h-auto w-full flex-col items-start gap-1 p-0 text-left font-normal whitespace-normal hover:bg-transparent dark:hover:bg-transparent" onClick={() => setOpenId(r.id)}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name || r.email || "Anonymous visitor"}</span>
                      {r.live && <Badge variant="secondary">live chat</Badge>}
                      {r.status === "open" && r.last_author === "visitor" && <Badge>awaiting reply</Badge>}
                      <span className="text-sm text-muted-foreground">{when(r.updated_at)} · {r.message_count} message{r.message_count === 1 ? "" : "s"}</span>
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">{r.last_author === "agent" ? "You: " : ""}{r.last_message}</span>
                  </Button>
                )}
              </ItemCard>
            ))}
          </ul>
        )}
    </section>
  );
}

function Thread({ id, token, onClose, onChange, onError }: { id: string; token: Token; onClose: () => void; onChange: () => void; onError: (e: unknown) => void }) {
  const [t, setT] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { api<Ticket>(token, `/tickets/${id}`).then(setT).catch(onError); }, [token, id, onError]);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api(token, `/tickets/${id}/messages`, "POST", { message: reply }); setReply(""); load(); onChange(); }
    catch (err) { onError(err); } finally { setBusy(false); }
  }
  async function setStatus(status: "open" | "closed") {
    try { await api(token, `/tickets/${id}`, "PATCH", { status }); onChange(); if (status === "closed") onClose(); else load(); }
    catch (err) { onError(err); }
  }

  if (!t) return <p className="text-muted-foreground">Loading…</p>;
  const mailto = t.email && `mailto:${t.email}?subject=${encodeURIComponent("Re: your question")}&body=${encodeURIComponent(`\n\n> ${t.messages[0]?.body ?? ""}`)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto">{t.name || "Anonymous visitor"}{t.email && <span className="font-normal text-muted-foreground"> · {t.email}</span>}</strong>
        {mailto && <Button variant="outline" size="sm" asChild><a href={mailto}>Reply by email</a></Button>}
        <Button variant="outline" size="sm" onClick={() => setStatus(t.status === "open" ? "closed" : "open")}>{t.status === "open" ? "Close" : "Reopen"}</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Collapse</Button>
      </div>
      {t.conversation.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Asked the bot first ({t.conversation.length})</summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {t.conversation.map((c, i) => <li key={i}>“{c.message}” <span className="text-muted-foreground">· {LEVEL[c.level]}</span></li>)}
          </ul>
        </details>
      )}
      <ol className="flex flex-col gap-2" aria-label="Messages">
        {t.messages.map((m) => (
          <li key={m.id} className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm", m.author === "agent" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted")}>
            <span className="sr-only">{m.author === "agent" ? "You" : "Visitor"}: </span>
            <span className="whitespace-pre-wrap">{m.body}</span>
            <span className={cn("mt-0.5 block text-xs", m.author === "agent" ? "text-primary-foreground/80" : "text-muted-foreground")}>{when(m.createdAt)}</span>
          </li>
        ))}
      </ol>
      <form className="flex flex-col gap-2" onSubmit={send}>
        <Label htmlFor={`reply-${id}`}>Reply <Hint>{t.live ? "(appears in the visitor’s widget while it is open)" : "(shown in the widget if the visitor is still there; use “Reply by email” otherwise)"}</Hint></Label>
        <Textarea id={`reply-${id}`} value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} required />
        <div><Button disabled={busy || !reply.trim()}>Send reply</Button></div>
      </form>
    </div>
  );
}

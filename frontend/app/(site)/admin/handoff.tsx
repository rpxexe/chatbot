"use client";

import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, ChevronUp, CircleCheck, Loader2, Mail, RefreshCw, RotateCcw, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { CHAT_INPUT } from "@/components/chat";
import { api, type Handoff, type Kb, type Token } from "./api";
import { EnabledSwitch, Hint, ItemCard } from "./ui";

type TicketRow = {
  id: string; name: string | null; email: string | null; live: boolean; status: "open" | "closed";
  created_at: string; updated_at: string; last_message: string; last_author: "visitor" | "agent"; message_count: number;
};
type Message = { id: number; author: "visitor" | "agent"; body: string; channel: "chat" | "email"; createdAt: string };
type Ticket = Omit<TicketRow, "last_message" | "last_author" | "message_count"> & {
  messages: Message[]; conversation: { message: string; level: "high" | "medium" | "low"; created_at: string }[];
};
type Status = "open" | "closed" | "all";

type Props = { token: Token; kb: Kb; onChange: () => void; onError: (e: unknown) => void };
type Focus = { id: string } | null;

// Agents need to see live-chat messages without reloading.
const REFRESH_MS = 5000;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const LEVEL: Record<Ticket["conversation"][number]["level"], string> = { high: "answered", medium: "low confidence", low: "not answered" };

export function HandoffPanel({ token, kb, focus, onChange, onError }: Props & { focus?: Focus }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Keyed by KB only: after a save the refetched settings equal the form, so no remount is needed. */}
      <Settings key={kb.id} token={token} kb={kb} onChange={onChange} onError={onError} />
      <Inbox token={token} kbId={kb.id} slug={kb.slug} focus={focus ?? null} onChange={onChange} onError={onError} />
    </div>
  );
}

function Settings({ token, kb, onChange, onError }: Props) {
  const [h, setH] = useState<Handoff>(kb.handoff);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Handoff>) => { setH((cur) => ({ ...cur, ...patch })); };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(token, `/kbs/${kb.id}`, "PATCH", { handoff: { ...h, ticket: !!h.ticket, live: !!h.live } });
      toast.success("Handoff settings saved");
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
              <Label htmlFor="ho-email">Email <Hint>(where new-message alerts go)</Hint></Label>
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
            <EnabledSwitch checked={!!h.ticket} onChange={(v) => set({ ticket: v })} label="Get a reply by email: visitor leaves their question and email, you reply below and it is emailed to them" />
            <EnabledSwitch checked={!!h.live} onChange={(v) => set({ live: v })} label="Chat with an agent: you answer below while the visitor waits in the widget" />
          </div>
          <div className="flex items-center gap-3">
            <Button disabled={busy}>Save</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Inbox({ token, kbId, slug, focus, onChange, onError }: { token: Token; kbId: number; slug: string; focus: Focus; onChange: () => void; onError: (e: unknown) => void }) {
  const [status, setStatus] = useState<Status>("open");
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () => api<TicketRow[]>(token, `/kbs/${kbId}/tickets?status=${status}`).then(setRows).catch(onError),
    [token, kbId, status, onError],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  // Opened from the bell or a toast: show it among the open conversations, expanded.
  useEffect(() => {
    if (!focus) return;
    if (status !== "open") { setRows(null); setStatus("open"); }
    setOpenId(focus.id);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a new focus arrives
  const refresh = () => { setRefreshing(true); load().finally(() => setRefreshing(false)); };

  return (
    <section aria-labelledby="inbox-h" aria-busy={rows === null || refreshing} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="inbox-h" className="mr-auto font-medium">Conversations with your team</h2>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} strokeWidth={1.75} aria-hidden="true" />
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
        <ToggleGroup
          type="single" variant="outline" spacing={0} value={status} aria-label="Ticket status"
          onValueChange={(v) => { if (v && v !== status) { setRows(null); setStatus(v as Status); } }}
        >
          <ToggleGroupItem value="open">Open</ToggleGroupItem>
          <ToggleGroupItem value="closed">Closed</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {rows === null ? <InboxSkeleton />
        : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {status === "all" ? "" : `${status} `}conversations. They start when a visitor picks “Chat with an agent” or “Get a reply by email”
            in the chat. To try it, turn one on above,{" "}
            <a className="underline underline-offset-2 hover:text-foreground" href={`/widget?kb=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">open your chat</a>{" "}
            and type “talk to a person”. The Test panel only lists the channels.
          </p>
        )
        : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <ItemCard key={r.id} className={cn(openId === r.id && "gap-0 overflow-hidden p-0")}>
                {openId === r.id ? (
                  <Thread id={r.id} token={token} onClose={() => setOpenId(null)} onChange={() => { load(); onChange(); }} onError={onError} />
                ) : (
                  <Button type="button" variant="ghost" className="h-auto w-full items-start justify-start gap-3 p-0 text-left font-normal whitespace-normal hover:bg-transparent dark:hover:bg-transparent" onClick={() => setOpenId(r.id)}>
                    <VisitorAvatar name={r.name || r.email} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.name || r.email || "Anonymous visitor"}</span>
                        {r.live && <Badge variant="secondary">live chat</Badge>}
                        {r.status === "open" && r.last_author === "visitor" && <Badge>awaiting reply</Badge>}
                        <span className="text-sm text-muted-foreground">{when(r.updated_at)} · {r.message_count} message{r.message_count === 1 ? "" : "s"}</span>
                      </span>
                      <span className="line-clamp-2 text-sm text-muted-foreground">{r.last_author === "agent" ? "You: " : ""}{r.last_message}</span>
                    </span>
                  </Button>
                )}
              </ItemCard>
            ))}
          </ul>
        )}
    </section>
  );
}

function InboxSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-label="Loading conversations">
      {[0, 1, 2].map((i) => (
        <ItemCard key={i} className="flex-row items-start gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        </ItemCard>
      ))}
    </ul>
  );
}

const initials = (s: string | null) => s?.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

function VisitorAvatar({ name }: { name: string | null }) {
  return (
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-subtle">
      {initials(name)}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const icon = { className: "size-3.5", strokeWidth: 1.75, "aria-hidden": true } as const;

/** One conversation, as a chat: who it is, what they asked the bot, the messages, and a reply box. */
function Thread({ id, token, onClose, onChange, onError }: { id: string; token: Token; onClose: () => void; onChange: () => void; onError: (e: unknown) => void }) {
  const [t, setT] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  // The reply on its way: shown at once, faded, until the server has it.
  const [pending, setPending] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  // Also email the reply. null: not chosen yet, so the default applies (on for "Get a reply by email" tickets, off for live chats).
  const [emailChoice, setEmailChoice] = useState<boolean | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(() => api<Ticket>(token, `/tickets/${id}`).then(setT).catch(onError), [token, id, onError]);
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep the newest message in view.
  const count = t?.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, pending]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = reply.trim();
    if (!text || pending) return;
    setPending(text);
    setReply("");
    try {
      const r = await api<{ emailed: boolean; emailFailed: boolean }>(token, `/tickets/${id}/messages`, "POST", { message: text, ...(t?.email ? { email: emailTo } : {}) });
      if (r.emailed) toast.success(`Reply sent to ${t!.email}`);
      if (r.emailFailed) toast.warning("Saved, but the email didn’t send", { description: "The visitor sees it in the chat if it is still open. The reason is in the backend log." });
      await load();
      onChange();
    }
    catch (err) { setReply(text); onError(err); }
    finally { setPending(null); }
  }
  async function setStatus(status: "open" | "closed") {
    setStatusBusy(true);
    try { await api(token, `/tickets/${id}`, "PATCH", { status }); toast.success(status === "closed" ? "Conversation closed" : "Conversation reopened"); onChange(); if (status === "closed") onClose(); else await load(); }
    catch (err) { onError(err); }
    finally { setStatusBusy(false); }
  }

  const emailTo = !!t?.email && (emailChoice ?? !t.live);
  if (!t) return <ThreadSkeleton />;
  const name = t.name || "Anonymous visitor";

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
        <VisitorAvatar name={t.name || t.email} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{name}</span>
            <Badge variant="secondary">{t.live ? "Live chat" : "Message"}</Badge>
            {t.status === "closed" && <Badge variant="outline">Closed</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{t.email || "No email given"} · started {when(t.created_at)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={statusBusy} onClick={() => setStatus(t.status === "open" ? "closed" : "open")}>
            {statusBusy ? <Loader2 {...icon} className="size-3.5 animate-spin" /> : t.status === "open" ? <CircleCheck {...icon} /> : <RotateCcw {...icon} />}
            {t.status === "open" ? "Close" : "Reopen"}
          </Button>
          <Button variant="ghost" size="sm" aria-label="Collapse conversation" onClick={onClose}><ChevronUp {...icon} className="size-4" /></Button>
        </div>
      </header>

      {t.conversation.length > 0 && (
        <details className="border-b px-5 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground"><Bot {...icon} className="mr-1.5 inline size-3.5 align-[-2px]" />Asked the bot first ({t.conversation.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 pb-1 pl-5">
            {t.conversation.map((c, i) => <li key={i}>“{c.message}” <span className="text-muted-foreground">· {LEVEL[c.level]}</span></li>)}
          </ul>
        </details>
      )}

      <ol ref={listRef} aria-label="Messages" aria-live="polite" className="flex max-h-[28rem] min-h-40 flex-col gap-3 overflow-y-auto bg-muted/40 px-5 py-4">
        {t.messages.map((m) => (
          <Bubble key={m.id} agent={m.author === "agent"} body={m.body}
            meta={`${m.author === "agent" ? "You" : name} · ${time(m.createdAt)}${m.channel === "email" ? (m.author === "agent" ? " · emailed" : " · by email") : ""}`} />
        ))}
        {pending && <Bubble agent body={pending} meta={emailTo ? "Sending and emailing…" : "Sending…"} pending />}
        {t.status === "closed" && <li className="self-center text-xs text-muted-foreground">Conversation closed. Replying reopens it.</li>}
      </ol>

      <form className="flex flex-col gap-1.5 border-t px-5 py-3" onSubmit={send}>
        <Label htmlFor={`reply-${id}`} className="sr-only">Reply to {name}</Label>
        <InputGroup aria-busy={!!pending} className={CHAT_INPUT}>
          <InputGroupTextarea
            id={`reply-${id}`} rows={1} maxLength={5000} className="max-h-40 min-h-9 py-2 pl-3.5 text-base leading-5 md:text-sm"
            placeholder={`Reply to ${name}`} value={reply} onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
            }}
          />
          <InputGroupAddon align="inline-end" className="self-end pb-1">
            <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-lg aria-disabled:opacity-40" aria-label="Send reply" aria-disabled={!!pending || !reply.trim()}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUp strokeWidth={1.75} aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          {t.email ? (
            <div className="flex items-center gap-2">
              <Switch id={`email-${id}`} size="sm" checked={emailTo} onCheckedChange={setEmailChoice} />
              <Label htmlFor={`email-${id}`} className="text-xs font-normal text-subtle">
                <Mail {...icon} />Also email to {t.email}
              </Label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No email given: replies show only in the visitor’s chat.</p>
          )}
          <p className="text-xs text-muted-foreground">Enter sends, Shift+Enter adds a line</p>
        </div>
      </form>
    </div>
  );
}

function Bubble({ agent, body, meta, pending }: { agent: boolean; body: string; meta: string; pending?: boolean }) {
  return (
    <li className={cn("flex max-w-[80%] flex-col gap-1", agent ? "items-end self-end" : "items-start self-start", pending && "opacity-60")}>
      <span className="sr-only">{agent ? "You" : "Visitor"}: </span>
      <div className={cn(
        "rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap",
        agent ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card",
      )}>{body}</div>
      <span className="px-1 text-[11px] text-muted-foreground">{meta}</span>
    </li>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading conversation">
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56 max-w-full" /></div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex min-h-40 flex-col gap-3 bg-muted/40 px-5 py-4">
        <Skeleton className="h-10 w-2/3 self-start rounded-2xl bg-card" />
        <Skeleton className="h-8 w-1/2 self-end rounded-2xl" />
        <Skeleton className="h-12 w-3/5 self-start rounded-2xl bg-card" />
      </div>
      <div className="flex items-end gap-2 border-t px-5 py-3"><Skeleton className="h-16 flex-1" /><Skeleton className="size-9" /></div>
    </div>
  );
}

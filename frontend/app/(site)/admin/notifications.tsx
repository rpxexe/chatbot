"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { api, type Token } from "./api";

type Row = { id: string; name: string | null; email: string | null; live: boolean; updated_at: string; last_message: string; last_author: "visitor" | "agent" };

const POLL_MS = 10_000;
const seenKey = (kbId: number) => `handoff-seen-${kbId}`;
// Per browser only: which visitor messages this person has already looked at.
const readSeen = (kbId: number) => { try { return localStorage.getItem(seenKey(kbId)) ?? ""; } catch { return ""; } };
const writeSeen = (kbId: number, iso: string) => { try { localStorage.setItem(seenKey(kbId), iso); } catch {} };

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  if (s < 60) return "just now";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
};

/**
 * The bell at the top right: open conversations waiting for your reply. Polls the selected chatbot's inbox, shows a
 * toast when a visitor writes, and counts what you haven't looked at since you last opened it.
 */
export function Notifications({ token, kbId, onOpen, onNew }: {
  token: Token; kbId: number; onOpen: (ticketId: string | null) => void; onNew: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [seen, setSeen] = useState(() => readSeen(kbId));
  const [open, setOpen] = useState(false);
  // Last updated_at per ticket from the previous poll; null until the first poll, so old messages don't toast.
  const known = useRef<Map<string, string> | null>(null);
  const handlers = useRef({ onOpen, onNew });
  handlers.current = { onOpen, onNew };

  const load = useCallback(async () => {
    try {
      const list = (await api<Row[]>(token, `/kbs/${kbId}/tickets?status=open`)).filter((r) => r.last_author === "visitor");
      const prev = known.current;
      if (prev) {
        const fresh = list.filter((r) => prev.get(r.id) !== r.updated_at);
        for (const r of fresh) {
          toast(`${r.live ? "Live chat" : "New message"} from ${r.name || r.email || "a visitor"}`, {
            id: `ticket-${r.id}`,
            description: r.last_message.length > 120 ? `${r.last_message.slice(0, 120)}…` : r.last_message,
            action: { label: "Open", onClick: () => handlers.current.onOpen(r.id) },
          });
        }
        if (fresh.length) handlers.current.onNew();
      }
      known.current = new Map(list.map((r) => [r.id, r.updated_at]));
      setRows(list);
    } catch { /* offline or signed out: the next poll tries again; the dashboard reports real errors */ }
  }, [token, kbId]);

  useEffect(() => {
    known.current = null;
    setSeen(readSeen(kbId));
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [kbId, load]);

  const unread = rows.filter((r) => r.updated_at > seen).length;
  function markRead() {
    const latest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), seen);
    writeSeen(kbId, latest);
    setSeen(latest);
  }
  function go(id: string | null) {
    setOpen(false);
    markRead();
    onOpen(id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative text-muted-foreground" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-medium">Waiting for a reply</h2>
          {unread > 0 && <Button variant="link" size="xs" className="h-auto p-0 text-xs text-subtle" onClick={markRead}>Mark all read</Button>}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No one is waiting. New visitor messages show up here.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => go(r.id)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                  <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", r.updated_at > seen ? "bg-brand" : "bg-transparent")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className="truncate font-medium">{r.name || r.email || "Anonymous visitor"}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{ago(r.updated_at)}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{r.live && "Live chat · "}{r.last_message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full justify-center font-normal" onClick={() => go(null)}>Open Handoff inbox</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

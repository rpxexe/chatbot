"use client";
import { toast } from "sonner";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownLeft, ArrowDownRight, ArrowUpLeft, ArrowUpRight, BellDot, Bot, Check, Play, CircleHelp, Headphones, MessageCircle, MessageSquare,
  MessagesSquare, RotateCcw, X, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { onColor, type Appearance } from "@/lib/appearance";
import { api, type Kb, type Token } from "./api";
import { EnabledSwitch, Hint } from "./ui";
import { ColorPicker } from "./color-picker";

type Props = { token: Token; kb: Kb; onChange: () => void; onError: (e: unknown) => void };

const PRESETS = ["#1f6b4a", "#2563eb", "#7c3aed", "#e11d48", "#ea580c", "#171717"];
// Same icons, same order, as ICONS in public/widget.js (Lucide shapes).
const ICONS: [NonNullable<Appearance["icon"]>, LucideIcon, string][] = [
  ["chat", MessageSquare, "Chat"], ["bubble", MessageCircle, "Bubble"], ["chats", MessagesSquare, "Conversation"],
  ["help", CircleHelp, "Help"], ["headset", Headphones, "Support"], ["bot", Bot, "Bot"],
];
// Stored names: "left"/"right" are the bottom corners (the original two).
const POSITIONS: [NonNullable<Appearance["position"]>, LucideIcon, string][] = [
  ["top-left", ArrowUpLeft, "Top left"], ["top-right", ArrowUpRight, "Top right"],
  ["left", ArrowDownLeft, "Bottom left"], ["right", ArrowDownRight, "Bottom right"],
];

/** How the website widget looks and behaves, in three tabs, with a live preview of the real widget page. */
export function CustomizePanel({ token, kb, onChange, onError }: Props) {
  const [a, setA] = useState<Appearance>(kb.appearance ?? {});
  const [starters, setStarters] = useState((kb.appearance?.suggestions ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Appearance>) => { setA((cur) => ({ ...cur, ...patch })); };
  // Capped to what the backend accepts (4 lines, 120 characters each), so the preview never shows what Save would refuse.
  const draft: Appearance = { ...a, suggestions: starters.split("\n").map((s) => s.trim().slice(0, 120)).filter(Boolean).slice(0, 4) };
  const customized = Object.values(draft).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== ""));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(token, `/kbs/${kb.id}`, "PATCH", { appearance: draft });
      toast.success("Appearance saved", { description: "Live on your website on the next page load." });
      onChange();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  // Back to the defaults in the form and preview; the website keeps the saved look until Save.
  function reset() {
    setA({});
    setStarters("");
    toast("Back to defaults", { description: "Save to apply." });
  }

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
      <Card>
        <CardContent>
          <form className="flex flex-col gap-6" onSubmit={save}>
            <Tabs defaultValue="style" className="gap-6">
              <TabsList>
                <TabsTrigger value="style">Style</TabsTrigger>
                <TabsTrigger value="button">Button</TabsTrigger>
                <TabsTrigger value="content">Content</TabsTrigger>
              </TabsList>

              <TabsContent value="style" className="flex flex-col gap-6">
                <Field label="Theme" hint="Auto follows the visitor's system setting">
                  <ToggleGroup type="single" variant="outline" spacing={0} value={a.theme ?? "auto"} onValueChange={(v) => v && set({ theme: v as Appearance["theme"] })} aria-label="Theme">
                    <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                    <ToggleGroupItem value="light">Light</ToggleGroupItem>
                    <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
                  </ToggleGroup>
                </Field>

                <Field label="Accent color" hint="Chat button, send button and the line beside quoted answers">
                  <div className="flex flex-wrap items-center gap-2">
                    <Swatch label="Default" active={!a.color} onClick={() => set({ color: undefined })} className="bg-[conic-gradient(#171717_0_50%,#ededed_0)]" />
                    {PRESETS.map((c) => (
                      <Swatch key={c} label={c} color={c} active={a.color === c} onClick={() => set({ color: c })} />
                    ))}
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                    <ColorPicker value={a.color} active={!!a.color && !PRESETS.includes(a.color)} onChange={(color) => set({ color })} />
                    {a.color && <span className="font-mono text-xs text-muted-foreground uppercase">{a.color}</span>}
                  </div>
                </Field>

                <Field label="Chat colors" hint="Leave on Theme to follow light or dark">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {([["background", "Background"], ["text", "Text"], ["bubble", "Visitor message"]] as const).map(([k, name]) => (
                      <ColorRow key={k} name={name} value={a[k]} fallback="Theme" onChange={(c) => set({ [k]: c })} />
                    ))}
                  </div>
                </Field>
              </TabsContent>

              <TabsContent value="button" className="flex flex-col gap-6">
                <Field label="Position" hint="Corner of the page the chat button sits in">
                  <IconChoice options={POSITIONS} value={a.position ?? "right"} onChange={(position) => set({ position })} label="Position" />
                </Field>
                <Field label="Icon" hint="Shown on the chat button while the chat is closed">
                  <IconChoice options={ICONS} value={a.icon ?? "chat"} onChange={(icon) => set({ icon })} label="Button icon" round />
                </Field>
                <Field label="Intro" hint="On a visitor's first page, the button arrives as a pill with this text, then folds into the icon">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <EnabledSwitch label={a.intro === false ? "Off" : "On"} checked={a.intro !== false} onChange={(v) => set({ intro: v })} />
                    <Input
                      aria-label="Intro text"
                      className="sm:max-w-64"
                      maxLength={40}
                      disabled={a.intro === false}
                      placeholder={`Ask ${a.title?.trim() || "Footnote"}`}
                      value={a.introText ?? ""}
                      onChange={(e) => set({ introText: e.target.value })}
                    />
                  </div>
                </Field>
                <Field label="Badge color" hint="The count on the button when a reply arrives while the chat is closed">
                  <div className="sm:max-w-56">
                    <ColorRow name="Badge" value={a.badge} fallback="Red" onChange={(badge) => set({ badge })} />
                  </div>
                </Field>
              </TabsContent>

              <TabsContent value="content" className="flex flex-col gap-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <Field label="Header title" htmlFor="c-title">
                    <Input id="c-title" maxLength={60} placeholder="Footnote" value={a.title ?? ""} onChange={(e) => set({ title: e.target.value })} />
                  </Field>
                  <Field label="Show sources" hint="Name the article each answer came from">
                    <EnabledSwitch label={a.sources === false ? "Hidden" : "Shown"} checked={a.sources !== false} onChange={(v) => set({ sources: v })} />
                  </Field>
                </div>
                <Field label="Greeting" htmlFor="c-greeting" hint="The first message visitors see">
                  <Textarea id="c-greeting" rows={2} maxLength={300} placeholder="Ask a question in your own words. My answers come from our help articles." value={a.greeting ?? ""} onChange={(e) => set({ greeting: e.target.value })} />
                </Field>
                <Field label="Starter questions" htmlFor="c-starters" hint="Up to 4, one per line. Shown under the greeting as buttons">
                  <Textarea id="c-starters" rows={4} value={starters} onChange={(e) => setStarters(e.target.value)} placeholder={"Where is my order?\nWhat is your refund policy?"} />
                </Field>
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center gap-3 border-t pt-5">
              <Button disabled={busy}>Save</Button>
              <Button type="button" variant="outline" onClick={reset} disabled={!customized}>
                <RotateCcw data-icon="inline-start" aria-hidden="true" />Reset all
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="xl:sticky xl:top-22">
        <Preview kb={kb} a={draft} />
      </div>
    </div>
  );
}

/** One row of icon buttons; hovering or focusing one names it. */
function IconChoice<T extends string>({ options, value, onChange, label, round }: {
  options: [T, LucideIcon, string][]; value: T; onChange: (v: T) => void; label: string; round?: boolean;
}) {
  return (
    <ToggleGroup type="single" variant="outline" spacing={2} value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label}>
      {options.map(([id, Icon, name]) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={id} aria-label={name} className={cn("size-10 p-0", round && "rounded-full")}>
              <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{name}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}

/** A named color with the themed picker, its hex (or what applies when unset), and a reset back to that. */
function ColorRow({ name, value, fallback, onChange }: { name: string; value?: string; fallback: string; onChange: (c: string | undefined) => void }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border p-2">
      <ColorPicker label={`${name} color`} value={value} active={!!value} onChange={onChange} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{name}</span>
        <span className="font-mono text-xs text-muted-foreground uppercase">{value ?? fallback}</span>
      </div>
      {value && (
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`Reset ${name.toLowerCase()} color`} title={`Back to ${fallback.toLowerCase()}`} onClick={() => onChange(undefined)}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}{hint && <Hint> · {hint}</Hint>}</Label>
      {children}
    </div>
  );
}

function Swatch({ label, color, active, onClick, className }: { label: string; color?: string; active: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn("grid size-8 place-items-center rounded-full border ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", active && "ring-2 ring-foreground", className)}
      style={color ? { background: color, color: onColor(color) } : undefined}
    >
      {active && color && <Check className="size-4" aria-hidden="true" />}
    </button>
  );
}

/** A mock website with the real widget page framed in the chosen corner. Reloads shortly after the settings stop changing. */
function Preview({ kb, a }: { kb: Kb; a: Appearance }) {
  const key = JSON.stringify(a);
  const [look, setLook] = useState(key);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLook(key), 500);
    return () => clearTimeout(t);
  }, [key]);
  const src = `/widget?${new URLSearchParams({ kb: kb.slug, preview: "1", look })}`;
  const left = a.position === "left" || a.position === "top-left";
  const top = a.position === "top-left" || a.position === "top-right";
  const ink = a.color;
  const Launcher = (ICONS.find(([id]) => id === a.icon) ?? ICONS[0])[1];
  const frame = useRef<HTMLIFrameElement>(null);

  // The widget page's close button and Escape post "chatbot:close" to the page around it, which widget.js handles on
  // a real site. Here this page is the one around it.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && e.data?.type === "chatbot:close") setOpen(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // The intro, as public/widget.js plays it: a pill with the text typing in, then folding into the button. `run` restarts
  // the letters' animation each time. Replays by itself when its text or switch changes.
  const introText = a.introText?.trim() || `Ask ${a.title?.trim() || "Footnote"}`;
  const [intro, setIntro] = useState<number | null>(null);
  const playIntro = () => {
    setOpen(false);
    setIntro(Date.now());
  };
  useEffect(() => {
    if (intro === null) return;
    const t = setTimeout(() => setIntro(null), 1400 + introText.length * 45);
    return () => clearTimeout(t);
  }, [intro, introText.length]);
  const introKey = `${a.intro !== false}|${introText}`;
  const firstIntro = useRef(introKey);
  useEffect(() => {
    if (introKey === firstIntro.current) return;
    firstIntro.current = introKey;
    if (a.intro !== false) {
      const t = setTimeout(playIntro, 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introKey]);
  const [badge, setBadge] = useState(false);

  // Same motion as public/widget.js: the panel grows out of the button's corner, the icons turn into each other.
  const icon = "absolute inset-0 grid place-items-center transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">Preview · questions asked here are not counted in analytics</p>
        <Button type="button" variant="outline" size="sm" onClick={playIntro} disabled={a.intro === false}>
          <Play data-icon="inline-start" aria-hidden="true" />Play intro
        </Button>
        <Button type="button" variant="outline" size="sm" aria-pressed={badge} onClick={() => { setBadge((b) => !b); setOpen(false); }} className={cn(badge && "bg-muted")}>
          <BellDot data-icon="inline-start" aria-hidden="true" />{badge ? "Hide badge" : "Show badge"}
        </Button>
      </div>
      <div className="relative h-[640px] overflow-hidden rounded-xl border bg-[repeating-linear-gradient(135deg,var(--muted)_0_1px,transparent_1px_14px)]">
        {/* Kept mounted while closed, like the real widget, so the preview chat survives closing. */}
        <iframe
          ref={frame}
          title="Widget preview"
          src={src}
          inert={!open}
          className={cn(
            "absolute h-[540px] w-[min(380px,calc(100%-32px))] rounded-2xl border bg-background shadow-lg transition-[opacity,transform] motion-reduce:transition-none",
            left ? "left-4" : "right-4",
            top ? "top-20" : "bottom-20",
            top ? (left ? "origin-top-left" : "origin-top-right") : left ? "origin-bottom-left" : "origin-bottom-right",
            open
              ? "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              : cn("pointer-events-none scale-90 opacity-0 duration-200 ease-[cubic-bezier(0.4,0,1,1)]", top ? "-translate-y-2.5" : "translate-y-2.5"),
          )}
        />
        <button
          type="button"
          aria-label={open ? "Close preview chat" : "Open preview chat"}
          onClick={() => { setIntro(null); setBadge(false); setOpen((o) => !o); }}
          className={cn(
            "absolute flex h-13 min-w-13 items-center justify-center rounded-full shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95",
            left ? "left-4" : "right-4",
            top ? "top-4" : "bottom-4",
            !ink && "bg-primary text-primary-foreground",
            intro !== null && "overflow-hidden",
          )}
          style={ink ? { background: ink, color: onColor(ink) } : undefined}
        >
          {/* The intro's sheen, as in public/widget.js: crosses once the last letter lands, ends as the pill folds. */}
          {intro !== null && (
            <span
              key={`sheen-${intro}`}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-[45%] -translate-x-[120%] bg-[linear-gradient(100deg,transparent,color-mix(in_srgb,currentColor_30%,transparent),transparent)] motion-safe:animate-[widget-sheen_0.9s_cubic-bezier(0.45,0,0.55,1)_both]"
              style={{ animationDelay: `${500 + introText.length * 45}ms` }}
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              "overflow-hidden text-[15px] font-medium tracking-[-0.01em] whitespace-nowrap transition-[max-width,padding,opacity] duration-[550ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none",
              intro !== null ? "max-w-60 px-[22px] opacity-100" : "max-w-0 px-0 opacity-0",
            )}
          >
            {intro !== null && [...introText].map((c, i) => (
              <span key={`${intro}-${i}`} className="inline-block whitespace-pre motion-safe:animate-[widget-type_0.35s_cubic-bezier(0.22,1,0.36,1)_backwards]" style={{ animationDelay: `${300 + i * 45}ms` }}>{c}</span>
            ))}
          </span>
          <span className={cn(icon, (open || intro !== null) && "scale-40 opacity-0", open ? "rotate-90" : intro !== null && "-rotate-90")} aria-hidden="true"><Launcher className="size-[22px]" strokeWidth={1.5} /></span>
          <span className={cn(icon, !open && "-rotate-90 scale-40 opacity-0")} aria-hidden="true"><X className="size-5" /></span>
          {badge && !open && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold shadow-[0_0_0_2px_var(--background)] animate-in zoom-in-0 duration-200 motion-reduce:animate-none"
              style={{ background: a.badge ?? "#e5484d", color: a.badge ? onColor(a.badge) : "#ffffff" }}
            >
              1
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

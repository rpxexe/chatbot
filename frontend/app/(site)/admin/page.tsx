"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { SignIn, useAuth } from "@clerk/nextjs";
import {
  BookA, BookOpenText, ChartLine, Crosshair, FlaskConical, LifeBuoy, ListChecks, MessageCircleQuestion, Palette, Plug, Tags, type LucideIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { api, ApiError, type Category, type Intent, type Kb, type Token } from "./api";
import { IntentsPanel } from "./intents";
import { FaqsPanel } from "./faqs";
import { DocumentsPanel } from "./documents";
import { CategoriesPanel } from "./categories";
import { PreviewPanel } from "./preview";
import { SynonymsPanel } from "./synonyms";
import { AnalyticsPanel } from "./analytics";
import { HandoffPanel } from "./handoff";
import { InstallPanel } from "./install";
import { CustomizePanel } from "./customize";
import { ChatbotSwitcher, ClerkNavUser, TokenNavUser } from "./nav";
import { SetupGuide } from "./setup";
import { Notifications } from "./notifications";
import { toast } from "sonner";

const TOKEN_KEY = "kb-admin-token";
const store = {
  get: () => { try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch {} },
};

type Tab = "setup" | "faqs" | "documents" | "categories" | "intents" | "synonyms" | "analytics" | "handoff" | "customize" | "install";
const TAB_LABEL: Record<Tab, string> = {
  setup: "Setup guide", faqs: "FAQs", documents: "Documents", categories: "Categories", intents: "Intents", synonyms: "Synonyms",
  analytics: "Analytics", handoff: "Handoff", customize: "Customize", install: "Install",
};
const TAB_HINT: Record<Tab, string> = {
  setup: "From an empty chatbot to answers on your website, in six steps",
  faqs: "Questions and answers the chatbot quotes word for word",
  documents: "Policies and guides, split into sections the chatbot can answer from",
  categories: "Groups for FAQs and documents. Rename or remove them here",
  intents: "What visitors are trying to do, matched by fixed word patterns",
  synonyms: "Words your visitors use that mean the same as the words in your content",
  analytics: "What visitors asked, and how the chatbot answered",
  handoff: "How visitors reach a person, and the conversations your team answers",
  customize: "Theme, color, position and texts of the chat on your website",
  install: "Put the chatbot on your website and choose where it may appear",
};
const NAV: { label: string; tabs: [Tab, LucideIcon][] }[] = [
  { label: "Get started", tabs: [["setup", ListChecks]] },
  { label: "Content", tabs: [["faqs", MessageCircleQuestion], ["documents", BookOpenText], ["categories", Tags]] },
  { label: "Matching", tabs: [["intents", Crosshair], ["synonyms", BookA]] },
  { label: "Visitors", tabs: [["analytics", ChartLine], ["handoff", LifeBuoy]] },
  { label: "Website", tabs: [["customize", Palette], ["install", Plug]] },
];
// The open tab lives in the URL hash (/admin#handoff), so a reload or a shared link opens the same tab.
const tabFromUrl = (): Tab | null => {
  const h = location.hash.slice(1);
  return Object.hasOwn(TAB_LABEL, h) ? (h as Tab) : null;
};
// The test panel sits beside the tabs that change answers. Everywhere else it opens from the header.
const DOCKED: Tab[] = ["faqs", "documents", "intents", "synonyms"];

// Set at build time. With Clerk, customers sign up and each sees only their own (or their organization's) chatbots.
// Without it, sign-in is the operator's ADMIN_TOKEN.
const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function Admin() {
  return CLERK ? <ClerkAdmin /> : <TokenAdmin />;
}

function ClerkAdmin() {
  const { isLoaded, isSignedIn, getToken, orgId, userId } = useAuth();
  // A stable function, so the dashboard's effects don't refetch on every render. Clerk refreshes the token itself.
  const latest = useRef(getToken);
  latest.current = getToken;
  const token = useCallback(() => latest.current(), []);

  if (!isLoaded) return null;
  if (!isSignedIn) return <main className="mt-[10vh] flex justify-center p-4"><SignIn routing="hash" forceRedirectUrl="/admin" signUpForceRedirectUrl="/admin" /></main>;
  // Switching organization switches tenant: remount so nothing from the previous one is left on screen.
  return <Dashboard key={orgId ?? userId} token={token} account={<ClerkNavUser />} />;
}

function TokenAdmin() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setToken(store.get()); }, []);
  const signOut = () => { store.set(""); setToken(""); };

  if (!token) return <Login onToken={(t) => { store.set(t); setToken(t); setError(""); }} error={error} />;
  return (
    <Dashboard
      token={token}
      account={<TokenNavUser onSignOut={signOut} />}
      onUnauthorized={(msg) => { signOut(); setError(msg); }}
    />
  );
}

function Dashboard({ token, account, onUnauthorized }: { token: Token; account: ReactNode; onUnauthorized?: (msg: string) => void }) {
  const [kbs, setKbs] = useState<Kb[] | null>(null);
  const [kbId, setKbId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [tab, setTabState] = useState<Tab>("faqs");
  const setTab = useCallback((t: Tab) => { setTabState(t); history.replaceState(null, "", `#${t}`); }, []);
  // Read after mount: the server render has no hash.
  useEffect(() => { const t = tabFromUrl(); if (t) setTabState(t); }, []);
  const [testing, setTesting] = useState(false);
  const firstLoad = useRef(true);
  const [version, setVersion] = useState(0);
  // A conversation to open in Handoff (from the bell or a toast). A new object each time, so the same one reopens.
  const [focus, setFocus] = useState<{ id: string } | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401 && onUnauthorized) return onUnauthorized(e.message);
    // Same message twice (e.g. a failing poll) shows one toast.
    const msg = (e as Error).message;
    toast.error(msg, { id: msg });
  }, [onUnauthorized]);
  const openTicket = useCallback((id: string | null) => { setTab("handoff"); setFocus(id ? { id } : null); }, [setTab]);

  useEffect(() => {
    api<Kb[]>(token, "/kbs")
      .then((list) => {
        setKbs(list);
        setKbId((cur) => (cur && list.some((k) => k.id === cur) ? cur : list[0]?.id ?? null));
        // A chatbot with no content yet opens on the setup guide.
        if (firstLoad.current && !tabFromUrl() && list[0] && list[0].faq_count + list[0].document_count === 0) setTab("setup");
        firstLoad.current = false;
      })
      .catch(fail);
  }, [token, version, fail]);

  useEffect(() => {
    if (!kbId) return;
    api<Category[]>(token, `/kbs/${kbId}/categories`).then(setCategories).catch(fail);
    api<Intent[]>(token, `/kbs/${kbId}/intents`).then(setIntents).catch(fail);
  }, [token, kbId, version, fail]);

  const kb = kbs?.find((k) => k.id === kbId) ?? null;
  const props = { token, kbId: kbId!, categories, intents, version, onChange: bump, onError: fail };
  const counts: Partial<Record<Tab, number | null>> = kb
    ? { faqs: kb.faq_count, documents: kb.document_count, categories: categories.length, intents: intents.length, handoff: kb.open_tickets || null }
    : {};

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pt-3">
          <Link href="/" className="group/logo flex h-8 items-center gap-2.5 px-2 font-medium group-data-[collapsible=icon]:px-1">
            <Logo className="h-5 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">Footnote</span>
          </Link>
          <ChatbotSwitcher token={token} kbs={kbs ?? []} kb={kb} onSelect={setKbId} onChange={bump} onError={fail} />
        </SidebarHeader>
        <SidebarContent className="group-data-[collapsible=icon]:pt-4">
          {kb && NAV.map((group) => (
            <SidebarGroup key={group.label} className="py-1 group-data-[collapsible=icon]:py-0.5">
              <SidebarGroupLabel className="h-6 font-normal">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.tabs.map(([t, Icon]) => (
                    <SidebarMenuItem key={t}>
                      <NavButton active={tab === t} label={TAB_LABEL[t]} icon={Icon} onSelect={() => setTab(t)} />
                      {counts[t] != null && <SidebarMenuBadge className="font-mono font-normal text-muted-foreground">{counts[t]}</SidebarMenuBadge>}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border pb-3">{account}</SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-sm sm:px-6">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          {kb && (
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="max-w-48 truncate">{kb.name}</BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>{TAB_LABEL[tab]}</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          )}
          {kb && (
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" className={cn("bg-card", DOCKED.includes(tab) && "xl:hidden")} onClick={() => setTesting(true)}>
                <FlaskConical className="size-3.5" strokeWidth={1.75} aria-hidden="true" />Test
              </Button>
              <Notifications token={token} kbId={kb.id} onOpen={openTicket} onNew={bump} />
            </div>
          )}
        </header>

        <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className={cn("mx-auto grid max-w-[1480px] items-start gap-8", kb && DOCKED.includes(tab) && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
            <div className="min-w-0">
              {kbs && kbs.length === 0 && (
                <div className="max-w-md">
                  <h1 className="text-2xl font-medium">No chatbots yet</h1>
                  <p className="mt-2 text-subtle">Create one with New chatbot, then add the FAQs and documents it may answer from.</p>
                </div>
              )}
              {kb && (
                <>
                  <header className="mb-6">
                    <h1 className="text-2xl font-medium">{TAB_LABEL[tab]}</h1>
                    <p className="mt-1 text-sm text-subtle">{TAB_HINT[tab]}</p>
                  </header>
                  {tab === "setup" && <SetupGuide kb={kb} onGo={setTab} onTest={() => setTesting(true)} />}
                  {tab === "faqs" && <FaqsPanel {...props} />}
                  {tab === "documents" && <DocumentsPanel {...props} />}
                  {tab === "categories" && <CategoriesPanel {...props} />}
                  {tab === "intents" && <IntentsPanel {...props} />}
                  {tab === "synonyms" && <SynonymsPanel {...props} />}
                  {tab === "analytics" && <AnalyticsPanel {...props} />}
                  {tab === "handoff" && <HandoffPanel token={token} kb={kb} focus={focus} onChange={bump} onError={fail} />}
                  {tab === "customize" && <CustomizePanel key={kb.id} token={token} kb={kb} onChange={bump} onError={fail} />}
                  {/* Keyed by KB so the websites field starts from the selected chatbot's list. */}
                  {tab === "install" && <InstallPanel key={kb.id} token={token} kb={kb} onChange={bump} onError={fail} />}
                </>
              )}
            </div>
            {kb && DOCKED.includes(tab) && (
              <aside className="hidden xl:sticky xl:top-22 xl:block">
                <Card className="gap-0 py-0"><CardContent className="p-5"><PreviewPanel key={kb.id} kb={kb} /></CardContent></Card>
              </aside>
            )}
          </div>
        </div>
      </SidebarInset>

      {kb && (
        <Sheet open={testing} onOpenChange={setTesting}>
          <SheetContent className="w-full overflow-y-auto p-6 pt-12 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>Test a question</SheetTitle>
              <SheetDescription>Ask {kb.name} a question as a visitor would</SheetDescription>
            </SheetHeader>
            <PreviewPanel key={kb.id} kb={kb} />
          </SheetContent>
        </Sheet>
      )}
    </SidebarProvider>
  );
}

/** A sidebar entry. On mobile the sidebar is a sheet, so choosing a section also closes it. */
function NavButton({ active, label, icon: Icon, onSelect }: { active: boolean; label: string; icon: LucideIcon; onSelect: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      isActive={active}
      tooltip={label}
      className="text-subtle data-active:text-foreground [&_svg]:size-[18px] [&>svg]:text-subtle data-active:[&>svg]:text-foreground group-data-[collapsible=icon]:p-[7px]!"
      onClick={() => { onSelect(); if (isMobile) setOpenMobile(false); }}
    >
      <Icon strokeWidth={1.75} />
      <span>{label}</span>
    </SidebarMenuButton>
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
    <main className="mx-auto mt-[16vh] max-w-sm px-4">
      <Logo className="mb-4 h-7" />
      <h1 className="text-2xl font-medium">Footnote admin</h1>
      <p className="mt-1 mb-6 text-sm text-subtle">Sign in with the operator token set as <span className="font-mono text-xs">ADMIN_TOKEN</span> on the server</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor="token">Admin token</Label>
        <Input id="token" type="password" className="bg-card" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="current-password" required />
        {msg && <Alert variant="destructive"><AlertDescription className="text-destructive">{msg}</AlertDescription></Alert>}
        <Button className="mt-2" disabled={busy || !value.trim()}>Sign in</Button>
      </form>
    </main>
  );
}

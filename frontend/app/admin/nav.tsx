"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useClerk, useOrganization, useOrganizationList, useUser } from "@clerk/nextjs";
import { Building2, Check, ChevronsUpDown, ExternalLink, LogOut, Plus, Trash2, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { api, type Kb, type Token } from "./api";

const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const icon = { strokeWidth: 1.75, "aria-hidden": true } as const;

/** Top of the sidebar: which chatbot you're editing. Collapsed, it stays as a square, so the nav below keeps its place. */
export function ChatbotSwitcher({ token, kbs, kb, onSelect, onChange, onError }: {
  token: Token; kbs: Kb[]; kb: Kb | null; onSelect: (id: number) => void; onChange: () => void; onError: (e: unknown) => void;
}) {
  const { isMobile } = useSidebar();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const { id } = await api(token, "/kbs", "POST", { name });
      setName(""); setCreating(false); onSelect(id); onChange();
    } catch (err) { onError(err); }
  }
  async function remove() {
    if (!kb || !confirm(`Delete the chatbot "${kb.name}" with ALL its FAQs, documents, categories, intents, synonyms and conversations? This cannot be undone.`)) return;
    try { await api(token, `/kbs/${kb.id}`, "DELETE"); onChange(); } catch (err) { onError(err); }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={kb?.name ?? "Chatbots"} className="data-[state=open]:bg-sidebar-accent">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">
                {kb ? initials(kb.name) : <Plus className="size-4" {...icon} />}
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-medium">{kb?.name ?? "No chatbot yet"}</span>
                <span className="truncate font-mono text-xs text-muted-foreground">{kb?.slug ?? "Create one to start"}</span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" {...icon} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-60 rounded-lg" align="start" side={isMobile ? "bottom" : "right"} sideOffset={4}>
            {kbs.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Chatbots</DropdownMenuLabel>
                <DropdownMenuGroup>
                  {kbs.map((k) => (
                    <DropdownMenuItem key={k.id} className="gap-2" onSelect={() => onSelect(k.id)}>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-medium">{initials(k.name)}</span>
                      <span className="flex-1 truncate">{k.name}</span>
                      {k.id === kb?.id && <Check className="size-4 text-muted-foreground" {...icon} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => setCreating(true)}><Plus {...icon} />New chatbot</DropdownMenuItem>
            {kb && (
              <>
                <DropdownMenuItem asChild>
                  <a href={`/?kb=${encodeURIComponent(kb.slug)}`} target="_blank" rel="noreferrer"><ExternalLink {...icon} />Open chat page</a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={remove}><Trash2 {...icon} />Delete {kb.name}</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent className="sm:max-w-md">
            <form onSubmit={create} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>New chatbot</DialogTitle>
                <DialogDescription>Each chatbot has its own FAQs, documents and settings, and its own line of code for your site</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Label htmlFor="kb-name">Name</Label>
                <Input id="kb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind support" maxLength={100} autoFocus required />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
                <Button disabled={!name.trim()}>Create chatbot</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Bottom of the sidebar: who is signed in, and their account menu. */
function NavUser({ name, detail, image, children }: { name: string; detail: string; image?: string; children: ReactNode }) {
  const { isMobile } = useSidebar();
  const person = (
    <>
      <Avatar className="size-8 rounded-lg">
        {image && <AvatarImage src={image} alt="" />}
        <AvatarFallback className="rounded-lg bg-sidebar-accent text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={name} className="data-[state=open]:bg-sidebar-accent">
              {person}
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" {...icon} />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-60 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
            <DropdownMenuLabel className="flex items-center gap-2 px-1 py-1.5 text-sm font-normal">{person}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Clerk: switch between your own account and your organizations (each is a separate set of chatbots). */
export function ClerkNavUser() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({ userMemberships: { infinite: true } });
  const clerk = useClerk();
  if (!user) return null;
  const name = user.fullName || user.username || user.primaryEmailAddress?.emailAddress || "Account";

  return (
    <NavUser name={name} detail={organization?.name ?? "Personal account"} image={user.imageUrl}>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Workspace</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={organization?.id ?? "personal"}
        onValueChange={(v) => setActive?.({ organization: v === "personal" ? null : v })}
      >
        <DropdownMenuRadioItem value="personal">Personal account</DropdownMenuRadioItem>
        {userMemberships.data?.map((m) => (
          <DropdownMenuRadioItem key={m.organization.id} value={m.organization.id}>{m.organization.name}</DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuItem onSelect={() => clerk.openCreateOrganization()}><Plus {...icon} />New organization</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => clerk.openUserProfile()}><UserRound {...icon} />Account settings</DropdownMenuItem>
      {organization && <DropdownMenuItem onSelect={() => clerk.openOrganizationProfile()}><Building2 {...icon} />Organization settings</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => clerk.signOut()}><LogOut {...icon} />Sign out</DropdownMenuItem>
    </NavUser>
  );
}

/** Admin-token sign-in: the platform operator, who has no account. */
export function TokenNavUser({ onSignOut }: { onSignOut: () => void }) {
  return (
    <NavUser name="Operator" detail="Signed in with admin token">
      <DropdownMenuItem onSelect={onSignOut}><LogOut {...icon} />Sign out</DropdownMenuItem>
    </NavUser>
  );
}

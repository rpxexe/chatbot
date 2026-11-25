"use client";
import { toast } from "sonner";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CodeBlock, EmbedGuide } from "@/components/embed-guide";
import { scriptTag } from "@/lib/embed";
import { api, type Kb, type Token } from "./api";
import { Hint } from "./ui";

type Props = { token: Token; kb: Kb; onChange: () => void; onError: (e: unknown) => void };

/** The embed snippet for this chatbot, how to add it on common platforms, and the websites allowed to embed it. */
export function InstallPanel({ token, kb, onChange, onError }: Props) {
  const [origin, setOrigin] = useState("");
  const [sites, setSites] = useState(kb.websites.join("\n"));
  const [busy, setBusy] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(token, `/kbs/${kb.id}`, "PATCH", { websites: sites.split(/[\s,]+/).filter(Boolean) });
      toast.success("Websites saved");
      onChange();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium">Add the chatbot to your website</h2>
            <p className="text-sm text-muted-foreground">One line, before <code>&lt;/body&gt;</code>, on every page that should show the chat button.</p>
          </div>
          <CodeBlock file="Embed code" text={scriptTag(origin, kb.slug)} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium">Step by step for your platform</h2>
            <p className="text-sm text-muted-foreground">The code below already has this chatbot’s address and id filled in.</p>
          </div>
          {origin && <EmbedGuide host={origin} slug={kb.slug} />}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={save}>
            <div>
              <h2 className="font-medium">Websites</h2>
              <p className="text-sm text-muted-foreground">
                Only these sites can show this chatbot. Leave empty to allow any site.
                List <code>www.</code> and bare domains separately if you use both.
              </p>
            </div>
            <Label htmlFor="websites">One per line <Hint>(e.g. shop.example.com)</Hint></Label>
            <Textarea id="websites" rows={4} value={sites} onChange={(e) => setSites(e.target.value)} placeholder={"example.com\nwww.example.com"} />
            <div className="flex items-center gap-3">
              <Button disabled={busy}>Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

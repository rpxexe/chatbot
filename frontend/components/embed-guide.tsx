"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { embedGuides } from "@/lib/embed";

/** Step-by-step embed instructions per platform, with copyable code. */
export function EmbedGuide({ host, slug }: { host: string; slug: string }) {
  const guides = embedGuides(host, slug);
  return (
    <Tabs defaultValue="html" className="gap-4">
      {/* Many platforms: the tab row scrolls sideways on narrow screens instead of squeezing. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList className="w-max">
          {guides.map((g) => <TabsTrigger key={g.id} value={g.id}>{g.label}</TabsTrigger>)}
        </TabsList>
      </div>
      {guides.map((g) => (
        <TabsContent key={g.id} value={g.id} className="flex flex-col gap-4">
          <ol className="flex flex-col gap-2 text-sm">
            {g.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-[11px] text-subtle">{i + 1}</span>
                <span className="text-subtle">{s}</span>
              </li>
            ))}
          </ol>
          <CodeBlock file={g.code.file} text={g.code.text} />
          {g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function CodeBlock({ file, text }: { file?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => navigator.clipboard.writeText(text).then(
    () => { setCopied(true); toast.success("Copied"); },
    () => toast.error("Couldn’t copy. Select the code and copy it instead."),
  );
  return (
    <div className="overflow-hidden rounded-lg border bg-muted">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{file}</span>
        <Button variant="ghost" size="xs" onClick={copy}>
          {copied ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-5" data-lenis-prevent><code>{text}</code></pre>
    </div>
  );
}

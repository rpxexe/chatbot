"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, Copy, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { docsMarkdown } from "@/lib/docs-md";
import { CodeBlock, EmbedGuide } from "@/components/embed-guide";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scriptTag } from "@/lib/embed";

const SLUG = "your-chatbot-id";

/** Like shadcn's docs: copy this page as Markdown for an AI assistant, or open it there directly. */
function CopyPage({ host }: { host: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const mdUrl = `${host}/docs.md`;
  const prompt = encodeURIComponent(`Read ${mdUrl} and help me add the Footnote chat widget to my website.`);
  const copy = () => navigator.clipboard.writeText(docsMarkdown(host)).then(
    () => { setCopied(true); toast.success("Page copied as Markdown"); },
    () => toast.error("Couldn’t copy. Open the Markdown file instead."),
  );
  const item = "gap-2";
  return (
    <div className="flex">
      <Button variant="outline" size="sm" className="rounded-r-none bg-card" onClick={copy}>
        {copied ? <Check data-icon="inline-start" aria-hidden="true" /> : <Copy data-icon="inline-start" aria-hidden="true" />}
        {copied ? "Copied" : "Copy page"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="-ml-px rounded-l-none bg-card px-1.5" aria-label="More ways to use this page">
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem className={item} onSelect={copy}><Copy aria-hidden="true" />Copy page as Markdown</DropdownMenuItem>
          <DropdownMenuItem className={item} asChild><a href="/docs.md" target="_blank" rel="noreferrer"><FileText aria-hidden="true" />View as Markdown</a></DropdownMenuItem>
          <DropdownMenuItem className={item} asChild><a href={`https://chatgpt.com/?q=${prompt}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Open in ChatGPT</a></DropdownMenuItem>
          <DropdownMenuItem className={item} asChild><a href={`https://claude.ai/new?q=${prompt}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Open in Claude</a></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const SECTIONS = [["quick-start", "Quick start"], ["platforms", "Your platform"], ["options", "Options"], ["javascript", "Open it from your page"], ["websites", "Allowed websites"], ["troubleshooting", "Troubleshooting"]] as const;

/** The public install guide (/docs), for people adding the widget to their site. */
export function Docs() {
  // The widget is served by this app, so the code points at wherever these docs are open.
  const [host, setHost] = useState("https://your-footnote-host");
  useEffect(() => setHost(window.location.origin), []);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="group/logo flex items-center gap-2.5 font-medium"><Logo className="h-6" />Footnote</Link>
          <span className="text-sm text-muted-foreground">Docs</span>
          <Button variant="ghost" size="sm" className="ml-auto text-subtle" asChild>
            <Link href="/"><ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />Home</Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:py-14">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 flex flex-col gap-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className="block rounded-md px-2 py-1 text-subtle hover:bg-muted hover:text-foreground">{label}</a></li>
            ))}
          </ul>
        </nav>

        <main className="flex min-w-0 flex-col gap-14">
          <div>
            <div className="mb-4 flex justify-end"><CopyPage host={host} /></div>
            <h1 className="text-3xl font-medium tracking-[-0.01em] sm:text-4xl">Add Footnote to your website</h1>
            <p className="mt-3 max-w-2xl text-subtle">
              One script tag puts the chat button on your site. It works with plain HTML, React, Next.js, Vue, Angular,
              WordPress, Shopify, Webflow, Wix, Squarespace and Google Tag Manager.
            </p>
          </div>

          <section id="quick-start" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Quick start</h2>
            <ol className="mt-4 flex flex-col gap-3 text-sm text-subtle">
              <li><strong className="font-medium text-foreground">1. Create a chatbot.</strong> Sign up, then create a chatbot in the dashboard and add your FAQs or documents.</li>
              <li><strong className="font-medium text-foreground">2. Copy its embed code.</strong> The dashboard’s <em>Install</em> tab shows it with your chatbot’s id filled in. It looks like this:</li>
            </ol>
            <div className="mt-4"><CodeBlock file="Before </body>" text={scriptTag(host, SLUG)} /></div>
            <p className="mt-4 text-sm text-subtle">
              <strong className="font-medium text-foreground">3. Paste it before <code>&lt;/body&gt;</code></strong> on every page that should show the chat.
              Replace <code>{SLUG}</code> with your chatbot’s id, shown under its name in the dashboard.
            </p>
          </section>

          <section id="platforms" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Step by step for your platform</h2>
            <p className="mt-2 text-sm text-subtle">Pick where your site is built. Each guide uses the same script tag.</p>
            <Card className="mt-4"><CardContent><EmbedGuide host={host} slug={SLUG} /></CardContent></Card>
          </section>

          <section id="options" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Options</h2>
            <p className="mt-2 text-sm text-subtle">
              Most settings (colors, position, icon, greeting, starter questions) are in the dashboard’s <em>Customize</em> tab and apply without changing the code.
              These attributes on the script tag override them for one site:
            </p>
            <Card className="mt-4 gap-0 py-0">
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-40 pl-5">Attribute</TableHead><TableHead className="pr-5">What it does</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow><TableCell className="pl-5 font-mono text-xs">data-kb</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">Which chatbot to show (required)</TableCell></TableRow>
                    <TableRow><TableCell className="pl-5 font-mono text-xs">data-title</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The chat panel’s title</TableCell></TableRow>
                    <TableRow><TableCell className="pl-5 font-mono text-xs">data-greeting</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The first message visitors see</TableCell></TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          <section id="javascript" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Open it from your page</h2>
            <p className="mt-2 text-sm text-subtle">
              Once loaded, the widget adds <code>window.chatbotWidget</code>. Use it for your own “Chat with us” buttons, or to remove the widget in a single-page app.
            </p>
            <div className="mt-4">
              <CodeBlock file="JavaScript" text={`// Open or close the chat panel
window.chatbotWidget?.open();
window.chatbotWidget?.close();

// Remove the widget completely (e.g. when leaving a page in a single-page app)
window.chatbotWidget?.destroy();`} />
            </div>
          </section>

          <section id="websites" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Allowed websites</h2>
            <p className="mt-2 text-sm text-subtle">
              In the dashboard’s <em>Install</em> tab, list the addresses of your sites (one per line, e.g. <code>shop.example.com</code>).
              Browsers then refuse to show your chatbot anywhere else. Leave the list empty to allow any site.
              List <code>www.</code> and the bare domain separately if you use both.
            </p>
          </section>

          <section id="troubleshooting" className="scroll-mt-24">
            <h2 className="text-xl font-medium">Troubleshooting</h2>
            <dl className="mt-4 flex flex-col gap-4 text-sm">
              {[
                ["The chat button doesn’t appear", "Check that the script tag is on the page (view the page source), that data-kb is your chatbot’s id, and that your site is in the allowed websites list, if you set one."],
                ["The chat shows a different chatbot", "data-kb names the chatbot. Copy the code again from the Install tab of the chatbot you want."],
                ["Design changes don’t show", "Press Save in Customize, then reload your site. Changes apply on the next page load."],
                ["It works locally but not on the live site", "Add the live address (e.g. www.example.com) to the allowed websites, and clear any page cache your host or plugin keeps."],
              ].map(([q, a]) => (
                <div key={q} className="rounded-lg border bg-card p-4">
                  <dt className="font-medium">{q}</dt>
                  <dd className="mt-1 text-subtle">{a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}

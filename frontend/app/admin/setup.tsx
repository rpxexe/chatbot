"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Kb } from "./api";

type Go = "faqs" | "documents" | "intents" | "synonyms" | "handoff" | "install" | "analytics";

type Step = {
  title: string;
  body: string;
  /** Known from the chatbot's data; undefined when it can't be told from here. */
  done?: boolean;
  optional?: boolean;
  actions: { label: string; to?: Go; test?: boolean }[];
};

/** How to set a chatbot up, in order. Steps tick themselves off where the data shows they're done. */
export function SetupGuide({ kb, onGo, onTest }: { kb: Kb; onGo: (tab: Go) => void; onTest: () => void }) {
  const h = kb.handoff;
  const steps: Step[] = [
    {
      title: "Add what the chatbot may answer from",
      body: "Write FAQs for the questions you get most, in your customers’ words. Upload policies, guides and help pages as documents: PDF, Word, Markdown, text, a CSV of FAQs, or a web address. The chatbot never answers from anything else.",
      done: kb.faq_count + kb.document_count > 0,
      actions: [{ label: "Add FAQs", to: "faqs" }, { label: "Add documents", to: "documents" }],
    },
    {
      title: "Test it like a visitor",
      body: "Ask real questions, including vague and misspelled ones. A green line under an answer means it came from your content, and the note names the source. If the wrong answer wins, reword the FAQ question or add keywords.",
      actions: [{ label: "Test a question", test: true }],
    },
    {
      title: "Teach it your visitors’ words",
      body: "Synonyms link the words visitors use to the words in your content, like “money back” to “refund”. Intents catch what someone is trying to do, like asking for a person, and can give a fixed reply.",
      optional: true,
      actions: [{ label: "Synonyms", to: "synonyms" }, { label: "Intents", to: "intents" }],
    },
    {
      title: "Choose how visitors reach a person",
      body: "When the chatbot can’t answer, or a visitor asks for a person, it offers the channels you set: email, a contact form, WhatsApp, a message to your team, or a live chat you answer from Handoff.",
      done: !!(h.email || h.contactUrl || h.whatsapp || h.ticket || h.live),
      actions: [{ label: "Set up handoff", to: "handoff" }],
    },
    {
      title: "Put it on your website",
      body: "Paste one line of code before </body> on your site. List your website addresses so no other site can show your chatbot.",
      actions: [{ label: "Get the code", to: "install" }],
    },
    {
      title: "Check what visitors ask",
      body: "Analytics lists the questions the chatbot couldn’t answer. Turn each one into an FAQ with one click, and the next visitor gets an answer.",
      actions: [{ label: "Open analytics", to: "analytics" }],
    },
  ];
  const known = steps.filter((s) => s.done !== undefined);
  const doneCount = known.filter((s) => s.done).length;

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 pb-8 last:pb-0">
            {/* The line joining the step markers. */}
            {i < steps.length - 1 && <span className="absolute top-8 bottom-0 left-[13px] w-px bg-border" aria-hidden="true" />}
            {s.done ? (
              <CircleCheck className="size-7 shrink-0 text-brand" strokeWidth={1.75} aria-label="Done" />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-xs text-subtle">{i + 1}</span>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <h2 className={cn("flex flex-wrap items-center gap-2 font-medium", s.done && "text-subtle")}>
                {s.title}
                {s.optional && <Badge variant="secondary" className="font-normal">Optional</Badge>}
              </h2>
              <p className="mt-1 text-sm text-subtle">{s.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.actions.map((a) => (
                  <Button key={a.label} variant="outline" size="sm" onClick={() => (a.test ? onTest() : onGo(a.to!))}>
                    {a.label}<ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="-mt-4 font-mono text-xs text-muted-foreground">{doneCount} of {known.length} tracked steps done</p>

      <section>
        <h2 className="font-medium">How an answer is chosen</h2>
        <p className="mt-1 text-sm text-subtle">
          Every question is matched against your FAQs and documents by the words they share, including synonyms and small typos.
          The same question always gets the same answer, and nothing is written that isn’t in your content.
        </p>
        <Card className="mt-4 gap-0 py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-40 pl-5">Match</TableHead><TableHead className="pr-5">What the visitor gets</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell className="pl-5 align-top">Strong</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The answer, with its source</TableCell></TableRow>
                <TableRow><TableCell className="pl-5 align-top">Close</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The best answer, plus “Did you mean” suggestions to confirm</TableCell></TableRow>
                <TableRow><TableCell className="pl-5 align-top">None</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">An honest “I couldn’t find an answer”, suggestions, and your handoff channels</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="font-medium">Widget options</h2>
        <p className="mt-1 text-sm text-subtle">Add these to the script tag from Install to change what visitors see</p>
        <Card className="mt-4 gap-0 py-0">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-40 pl-5">Attribute</TableHead><TableHead className="pr-5">What it does</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                <TableRow><TableCell className="pl-5 font-mono text-xs">data-kb</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">Which chatbot to show. This one is <span className="font-mono text-xs text-foreground">{kb.slug}</span></TableCell></TableRow>
                <TableRow><TableCell className="pl-5 font-mono text-xs">data-title</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The panel title, “Help” by default</TableCell></TableRow>
                <TableRow><TableCell className="pl-5 font-mono text-xs">data-greeting</TableCell><TableCell className="pr-5 whitespace-normal text-subtle">The first message visitors see</TableCell></TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

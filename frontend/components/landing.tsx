"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { BarChart3, BookOpenCheck, Code2, Database, FileText, HelpCircle, MessagesSquare, UserRound } from "lucide-react";
import { Chat } from "@/components/chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const NAME = "Help Assistant";
// Inlined at build. Without Clerk, /admin signs in with the operator token and there is no sign-up.
const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const icon = { className: "size-5 text-brand", strokeWidth: 1.75, "aria-hidden": true } as const;

const FEATURES = [
  { icon: BookOpenCheck, title: "Quotes your content", text: "Every answer comes from one of your FAQs or articles and names the one it came from." },
  { icon: MessagesSquare, title: "Understands how people ask", text: "Synonyms, small talk and follow-ups like “what about international orders?” are read in context." },
  { icon: HelpCircle, title: "Asks instead of guessing", text: "When the match is weak it offers “Did you mean” suggestions rather than a wrong answer." },
  { icon: UserRound, title: "Hands off to a person", text: "Email, WhatsApp, a contact form, tickets or a live agent, whichever you switch on." },
  { icon: BarChart3, title: "Shows what is missing", text: "Analytics lists the questions it couldn't answer. Turn one into an FAQ in a click." },
  { icon: Database, title: "No AI bill", text: "PostgreSQL full-text search. No LLM, no embeddings, no per-message API cost." },
];

const STEPS = [
  { icon: FileText, title: "Add your content", text: "Write FAQs, upload files, import a web page or paste text." },
  { icon: MessagesSquare, title: "Test it", text: "Ask questions in the preview and see the answer, source and match score." },
  { icon: Code2, title: "Embed it", text: "Paste one script tag on your site. The widget does the rest." },
];

export function Landing() {
  const root = useRef<HTMLDivElement>(null);

  // Lenis drives the scroll; GSAP's ticker drives Lenis so ScrollTrigger sees the same position.
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ anchors: { offset: -72 } });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        // [data-hero] / [data-demo] start hidden in globals.css so they don't flash before hydration.
        gsap
          .timeline({ defaults: { ease: "power3.out", duration: 0.8 } })
          .fromTo("[data-hero]", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, stagger: 0.08 })
          .fromTo("[data-demo]", { autoAlpha: 0, y: 32, scale: 0.98 }, { autoAlpha: 1, y: 0, scale: 1 }, "-=0.55");

        gsap.set("[data-reveal]", { autoAlpha: 0, y: 28 });
        ScrollTrigger.batch("[data-reveal]", {
          start: "top 88%",
          once: true,
          onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, stagger: 0.08, duration: 0.7, ease: "power3.out" }),
        });

        gsap.fromTo("[data-step-line]", { scaleX: 0 }, {
          scaleX: 1,
          ease: "none",
          scrollTrigger: { trigger: "#how", start: "top 70%", end: "center 50%", scrub: true },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <span className="flex size-7 items-center justify-center rounded-lg bg-brand text-brand-foreground">
              <MessagesSquare className="size-4" strokeWidth={2} aria-hidden="true" />
            </span>
            {NAME}
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {[["#features", "Features"], ["#how", "How it works"], ["#demo", "Try it"]].map(([href, label]) => (
              <Button key={href} variant="ghost" size="sm" className="text-subtle" asChild>
                <a href={href}>{label}</a>
              </Button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AuthButtons />
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_minmax(0,30rem)] lg:py-24">
          <div className="max-w-xl">
            <Badge data-hero variant="outline" className="rounded-full border-brand/30 bg-brand-soft px-3 py-1 text-brand">
              No LLM. No AI APIs.
            </Badge>
            <h1 data-hero className="mt-6 text-4xl font-medium tracking-[-0.02em] text-balance sm:text-5xl lg:text-6xl">
              Answers from your help content, with the source attached.
            </h1>
            <p data-hero className="mt-6 text-lg text-subtle text-pretty">
              {NAME} answers your customers from your own FAQs and articles. It names where each answer came from,
              asks when it isn't sure, and hands off to a person when it can't help.
            </p>
            <div data-hero className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <a href="#demo">Try the demo</a>
              </Button>
              <PrimaryCta size="lg" variant="outline" />
            </div>
          </div>

          <Card id="demo" data-demo className="h-[34rem] gap-0 overflow-hidden py-0 shadow-sm">
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
              <span className="text-sm font-medium">Live demo</span>
              <span className="text-sm text-muted-foreground">Ask about refunds, shipping or accounts</span>
            </div>
            <Chat
              className="flex-1"
              empty={
                <div>
                  <h2 className="text-xl font-medium">What do you need to know?</h2>
                  <p className="mt-2 text-sm text-subtle">This demo answers from a sample store's help articles.</p>
                </div>
              }
              suggestions={["What is your refund policy?", "Do you ship internationally?", "How do I reset my password?"]}
            />
          </Card>
        </section>

        <section id="features" className="border-t bg-card/50">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <div data-reveal className="max-w-2xl">
              <h2 className="text-3xl font-medium tracking-[-0.01em] sm:text-4xl">Built to be trusted, not to sound clever</h2>
              <p className="mt-4 text-subtle">It only says what your content says. When that isn't enough, it tells the visitor and gets them to a person.</p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <Card key={title} data-reveal className="gap-3 shadow-none">
                  <CardHeader className="gap-3">
                    <Icon {...icon} />
                    <CardTitle className="font-medium">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-subtle">{text}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <h2 data-reveal className="max-w-2xl text-3xl font-medium tracking-[-0.01em] sm:text-4xl">Live on your site in three steps</h2>
            <div className="relative mt-12">
              <div data-step-line className="absolute top-5 right-[16%] left-[16%] hidden h-px origin-left bg-brand/40 md:block" aria-hidden="true" />
              <ol className="grid gap-10 md:grid-cols-3">
                {STEPS.map(({ icon: Icon, title, text }, i) => (
                  <li key={title} data-reveal className="relative flex flex-col items-start gap-4 md:items-center md:text-center">
                    <span className="flex size-10 items-center justify-center rounded-full border bg-background">
                      <Icon {...icon} />
                    </span>
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">Step {i + 1}</p>
                      <h3 className="mt-1 font-medium">{title}</h3>
                      <p className="mt-2 max-w-xs text-sm text-subtle">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <Card data-reveal className="mx-auto mt-14 max-w-2xl gap-0 py-0 shadow-none">
              <div className="border-b px-4 py-2.5 text-xs text-muted-foreground">Paste before &lt;/body&gt;</div>
              <pre className="overflow-x-auto px-4 py-4 font-mono text-sm" data-lenis-prevent>
                <code>{`<script src="https://your-host/widget.js" data-kb="your-chatbot" async></script>`}</code>
              </pre>
            </Card>
          </div>
        </section>

        <section className="border-t bg-card/50">
          <div data-reveal className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-medium tracking-[-0.01em]">Set up your chatbot</h2>
              <p className="mt-2 text-subtle">Add your content, check the answers, embed it. Your dashboard is waiting.</p>
            </div>
            <div className="flex gap-3">
              <PrimaryCta size="lg" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>{NAME}</span>
          <Separator className="sm:hidden" />
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

/** Header: Log in + Sign up while signed out, Dashboard once signed in. */
function AuthButtons() {
  if (!CLERK) return <Button size="sm" asChild><Link href="/admin">Log in</Link></Button>;
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal" forceRedirectUrl="/admin" signUpForceRedirectUrl="/admin">
          <Button variant="ghost" size="sm">Log in</Button>
        </SignInButton>
        <SignUpButton mode="modal" forceRedirectUrl="/admin" signInForceRedirectUrl="/admin">
          <Button size="sm">Sign up</Button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <Button size="sm" asChild><Link href="/admin">Dashboard</Link></Button>
      </Show>
    </>
  );
}

/** "Get started" opens sign-up; signed in (or without Clerk) it goes straight to the dashboard. */
function PrimaryCta({ size, variant = "default" }: { size: "sm" | "lg"; variant?: "default" | "outline" }) {
  const dashboard = <Button size={size} variant={variant} asChild><Link href="/admin">Open dashboard</Link></Button>;
  if (!CLERK) return dashboard;
  return (
    <>
      <Show when="signed-out">
        <SignUpButton mode="modal" forceRedirectUrl="/admin" signInForceRedirectUrl="/admin">
          <Button size={size} variant={variant}>Get started</Button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">{dashboard}</Show>
    </>
  );
}

import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found · Footnote" };

// Any unknown URL. Written as the bot's own "nothing found" reply: same green rule and source line as a chat answer.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-8">
        <Link href="/" className="group/logo flex items-center gap-2.5 self-start font-medium">
          <Logo className="h-6" />
          Footnote
        </Link>

        <div className="flex flex-col gap-4">
          <p className="max-w-[85%] self-end rounded-xl bg-muted px-3 py-2 text-sm">Where is this page?</p>
          <div className="border-l-2 border-brand pl-4">
            <h1 className="text-2xl font-medium tracking-[-0.01em]">I couldn’t find that page.</h1>
            <p className="mt-2 text-subtle">The link may be old, or the address mistyped. Nothing here matches it.</p>
            <p className="mt-3 font-mono text-xs text-muted-foreground">Error 404</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin">Open the dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

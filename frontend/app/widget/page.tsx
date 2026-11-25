import { headers } from "next/headers";
import { Chat } from "@/components/chat";
import { APPEARANCE_HEADER, cleanAppearance, themeVars, type Appearance } from "@/lib/appearance";
import { CloseWidget, RootTheme } from "./close";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The saved settings, fetched once by proxy.ts (which needs the same response for frame-ancestors). Base64 UTF-8 JSON. */
async function saved(): Promise<Appearance> {
  try {
    return cleanAppearance(JSON.parse(Buffer.from((await headers()).get(APPEARANCE_HEADER) ?? "", "base64").toString("utf8")));
  } catch {
    return {}; // defaults
  }
}

/**
 * The website widget's panel. public/widget.js frames it on customers' sites; proxy.ts limits which sites may.
 * Looks come from the dashboard's Customize tab. The tab's live preview passes preview=1 (questions not counted in
 * analytics) and `look`: the whole unsaved form, used instead of the saved settings, so a cleared field shows cleared.
 * data-title / data-greeting on the script still win.
 */
export default async function WidgetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const kb = one(q.kb) || "default";
  const preview = one(q.preview) === "1";
  let look: unknown = {};
  try { look = JSON.parse(one(q.look) ?? "{}"); } catch { /* ignore a broken preview value */ }
  const a: Appearance = preview ? cleanAppearance(look) : await saved();
  const title = one(q.title) || a.title || "Footnote";
  const greeting = one(q.greeting) || a.greeting || "Ask a question in your own words. My answers come from our help articles.";
  const theme = a.theme === "light" || a.theme === "dark" ? a.theme : undefined;
  const vars = themeVars(a);
  return (
    <div data-theme={theme} style={vars} className="flex h-dvh flex-col bg-background text-foreground">
      <RootTheme theme={theme} vars={vars as Record<string, string> | undefined} />
      <header className="flex items-center gap-3 border-b py-3 pr-3 pl-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium">{title}</h1>
          <p className="text-xs text-muted-foreground">Answers from our help articles</p>
        </div>
        <CloseWidget />
      </header>
      {/* Not "chatbot-widget:": the old widget stored messages in another shape under that key on same-origin pages. */}
      <Chat
        className="flex-1"
        storageKey={preview ? undefined : `chatbot-chat:${kb}`}
        greeting={greeting}
        suggestions={a.suggestions}
        sources={a.sources !== false}
        preview={preview}
      />
    </div>
  );
}

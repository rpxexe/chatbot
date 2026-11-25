import { docsMarkdown } from "@/lib/docs-md";

// /docs.md: the install docs as plain Markdown, for AI assistants and anyone who wants the text.
export function GET(request: Request) {
  return new Response(docsMarkdown(new URL(request.url).origin), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}

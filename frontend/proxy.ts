import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { APPEARANCE_HEADER } from "@/lib/appearance";

// Clerk keeps its session cookie fresh here. Pages are not blocked: the admin page shows sign-in itself, and the API
// checks every admin request. Without Clerk configured this does nothing.
const clerk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? clerkMiddleware() : () => NextResponse.next();

/**
 * The widget page is framed by customers' sites. Chat requests from inside the frame carry this app's Origin, so the
 * backend's website check can't see the customer's site: frame-ancestors enforces the owner's list instead.
 */
async function widget(req: NextRequest) {
  const kb = req.nextUrl.searchParams.get("kb") || "default";
  let ancestors = "'self'";
  let appearance = {};
  try {
    // A hung backend must not hold every widget load: after 3s, the defaults.
    const res = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/api/widget/${encodeURIComponent(kb)}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = (await res.json()) as { websites: string[]; appearance?: object };
      ancestors = data.websites.length ? `'self' ${data.websites.join(" ")}` : "*";
      appearance = data.appearance ?? {};
    }
  } catch { /* backend down: frame only on our own pages; the chat would fail anyway */ }
  // Always set, so a value sent by the browser never reaches the page. Base64 of the UTF-8 JSON: compact for any script
  // (percent-encoding grows non-Latin text up to 9x, toward the 16 KB header limit).
  const headers = new Headers(req.headers);
  headers.set(APPEARANCE_HEADER, btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(appearance)))));
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  return res;
}

export default function proxy(req: NextRequest, ev: NextFetchEvent) {
  return req.nextUrl.pathname === "/widget" ? widget(req) : clerk(req, ev);
}

export const config = {
  // Clerk's recommended matcher: skip Next internals and static files. "\\." is a literal dot; a bare "\." in a JS
  // string is just "." (any character), which skipped paths like /admin/documents.
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};

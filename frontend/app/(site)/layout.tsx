import { ClerkProvider } from "@clerk/nextjs";

// The landing page and dashboard: the only pages that sign people in. Clerk only when configured (see admin/page.tsx).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{children}</ClerkProvider> : children;
}

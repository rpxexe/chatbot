import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";

// The landing page and dashboard: the only pages that sign people in. Clerk only when configured (see admin/page.tsx).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const page = <>{children}<Toaster position="bottom-right" closeButton /></>;
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{page}</ClerkProvider> : page;
}

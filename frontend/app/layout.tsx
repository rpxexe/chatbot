import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Sources, scores and counts: the figures a reader checks.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = { title: "Help Assistant" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans antialiased", geist.variable, geistMono.variable)}>
      {/* Clerk only when configured (see admin/page.tsx); the public chat page never needs it. */}
      <body>
        <TooltipProvider>{process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{children}</ClerkProvider> : children}</TooltipProvider>
      </body>
    </html>
  );
}

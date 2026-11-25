import "./globals.css";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
// Sources, scores and counts: the figures a reader checks.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = { title: "Footnote" };

// No Clerk here: the widget page (/widget) loads on customers' sites and never signs anyone in. Clerk wraps only the
// landing page and dashboard, in app/(site)/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans antialiased", geist.variable, geistMono.variable)}>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}

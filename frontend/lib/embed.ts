/**
 * How to put the widget on a site, per platform. Shared by the dashboard's Install tab (with the real host and slug)
 * and the public /docs page (with placeholders). Every guide adds the same script tag (public/widget.js).
 */
export type EmbedGuide = {
  id: string;
  label: string;
  /** Numbered steps. */
  steps: string[];
  /** The code to paste, and the file or box it goes in. */
  code: { file: string; text: string; lang: "html" | "tsx" | "vue" | "ts" };
  note?: string;
};

export const scriptTag = (host: string, slug: string) => `<script src="${host}/widget.js" data-kb="${slug}" async></script>`;

export function embedGuides(host: string, slug: string): EmbedGuide[] {
  const tag = scriptTag(host, slug);
  return [
    {
      id: "html",
      label: "HTML",
      steps: [
        "Open each page that should show the chat button, or the shared footer/layout file if your site has one.",
        "Paste the line just before the closing </body> tag.",
        "Upload the changed files and reload your site: the chat button appears in the corner.",
      ],
      code: { file: "index.html", lang: "html", text: `<body>\n  ...\n  ${tag}\n</body>` },
    },
    {
      id: "react",
      label: "React",
      steps: [
        "Simplest: open public/index.html (Create React App) or index.html (Vite) and paste the line before </body>. It shows on every route.",
        "Or, to load it from code (e.g. only for signed-in pages), add this component once near the root of your app, such as in App.tsx.",
        "It loads the script once and removes the widget when the component unmounts.",
      ],
      code: {
        file: "ChatWidget.tsx",
        lang: "tsx",
        text: `import { useEffect } from "react";

export function ChatWidget() {
  useEffect(() => {
    const s = document.createElement("script");
    s.src = "${host}/widget.js";
    s.dataset.kb = "${slug}";
    s.async = true;
    document.body.appendChild(s);
    return () => {
      (window as any).chatbotWidget?.destroy();
      s.remove();
    };
  }, []);
  return null;
}

// In App.tsx: <ChatWidget />`,
      },
    },
    {
      id: "next",
      label: "Next.js",
      steps: [
        "Open your root layout: app/layout.tsx (App Router) or pages/_app.tsx (Pages Router).",
        "Import Script from next/script and add it inside <body>, after {children}.",
        "Deploy. The widget loads after the page is interactive, on every route.",
      ],
      code: {
        file: "app/layout.tsx",
        lang: "tsx",
        text: `import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="${host}/widget.js" data-kb="${slug}" strategy="afterInteractive" />
      </body>
    </html>
  );
}`,
      },
    },
    {
      id: "vue",
      label: "Vue / Nuxt",
      steps: [
        "Vue (Vite): paste the line before </body> in index.html at the project root.",
        "Nuxt: add it to the head scripts in nuxt.config.ts, as below. It loads on every page.",
      ],
      code: {
        file: "nuxt.config.ts",
        lang: "ts",
        text: `export default defineNuxtConfig({
  app: {
    head: {
      script: [{ src: "${host}/widget.js", "data-kb": "${slug}", async: true, tagPosition: "bodyClose" }],
    },
  },
});`,
      },
    },
    {
      id: "angular",
      label: "Angular",
      steps: [
        "Open src/index.html.",
        "Paste the line before </body>.",
        "Run ng build (or ng serve) again: the widget shows on every route.",
      ],
      code: { file: "src/index.html", lang: "html", text: `<body>\n  <app-root></app-root>\n  ${tag}\n</body>` },
    },
    {
      id: "wordpress",
      label: "WordPress",
      steps: [
        "Install the free WPCode plugin (Plugins → Add New → search “WPCode”) and activate it.",
        "Go to Code Snippets → Header & Footer.",
        "Paste the line into the Footer box and click Save Changes.",
      ],
      code: { file: "WPCode → Footer", lang: "html", text: tag },
      note: "Without a plugin: Appearance → Theme File Editor → footer.php, paste before </body>. Theme updates can overwrite it, so a child theme or plugin is safer.",
    },
    {
      id: "shopify",
      label: "Shopify",
      steps: [
        "In Shopify admin go to Online Store → Themes.",
        "Next to your live theme click ⋯ → Edit code, then open layout/theme.liquid.",
        "Paste the line just before </body> and click Save.",
      ],
      code: { file: "layout/theme.liquid", lang: "html", text: `  ${tag}\n</body>` },
    },
    {
      id: "webflow",
      label: "Webflow",
      steps: [
        "Open Site settings → Custom code.",
        "Paste the line into Footer code (“Before </body> tag”) and save.",
        "Publish the site. Custom code needs a paid site plan.",
      ],
      code: { file: "Site settings → Custom code → Footer", lang: "html", text: tag },
    },
    {
      id: "wix",
      label: "Wix",
      steps: [
        "In your site dashboard go to Settings → Custom code (under Advanced).",
        "Click + Add Custom Code and paste the line.",
        "Choose All pages, Load code once, place it in Body - end, then Apply. Needs a Premium plan and a connected domain.",
      ],
      code: { file: "Settings → Custom code", lang: "html", text: tag },
    },
    {
      id: "squarespace",
      label: "Squarespace",
      steps: [
        "Go to Settings → Developer tools → Code injection (older sites: Settings → Advanced → Code injection).",
        "Paste the line into the Footer box and save.",
        "Code injection needs a Core plan or higher.",
      ],
      code: { file: "Code injection → Footer", lang: "html", text: tag },
    },
    {
      id: "gtm",
      label: "Google Tag Manager",
      steps: [
        "In your container create a new tag of type Custom HTML and paste the line.",
        "Set the trigger to All Pages (or Initialization - All Pages).",
        "Save, then Submit → Publish the container.",
      ],
      code: { file: "Tag → Custom HTML", lang: "html", text: tag },
    },
  ];
}

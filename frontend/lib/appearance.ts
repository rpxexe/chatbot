import type { CSSProperties } from "react";

/** A chatbot's Customize settings (backend/src/appearance.ts). Unset = the widget's default. */
export type Appearance = {
  theme?: "auto" | "light" | "dark";
  color?: string;
  background?: string;
  text?: string;
  bubble?: string;
  badge?: string;
  intro?: boolean;
  introText?: string;
  /** "right" / "left" are the bottom corners (the original two); "top-right" / "top-left" the top ones. */
  position?: "right" | "left" | "top-right" | "top-left";
  icon?: "chat" | "bubble" | "chats" | "help" | "headset" | "bot";
  title?: string;
  greeting?: string;
  suggestions?: string[];
  sources?: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Carries the saved settings from proxy.ts to app/widget/page.tsx, so the backend is asked once per widget load. */
export const APPEARANCE_HEADER = "x-widget-appearance";

/**
 * Keeps only well-typed fields of an untrusted value (the Customize preview's `look` URL parameter), so a crafted link
 * can't break the widget page. The backend validates saved settings fully (backend/src/appearance.ts).
 */
export function cleanAppearance(v: unknown): Appearance {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["theme", "color", "background", "text", "bubble", "badge", "position", "icon", "title", "greeting", "introText"]) {
    if (typeof o[k] === "string") out[k] = o[k];
  }
  for (const k of ["sources", "intro"]) if (typeof o[k] === "boolean") out[k] = o[k];
  if (Array.isArray(o.suggestions)) out.suggestions = o.suggestions.filter((s) => typeof s === "string").slice(0, 4);
  return out as Appearance;
}

/** Black or white, whichever reads better on the color (WCAG relative luminance). */
export function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

/**
 * CSS variables that recolor the chat. Accent: send button, focus ring, source rule. Background and text: every
 * surface and the softer text shades, mixed from the two so they stay readable together. Bubble: the visitor's message.
 */
export function themeVars(a: Appearance): CSSProperties | undefined {
  const v: Record<string, string> = {};
  if (a.color && HEX.test(a.color)) Object.assign(v, { "--brand": a.color, "--ring": a.color, "--primary": a.color, "--primary-foreground": onColor(a.color) });
  if (a.background && HEX.test(a.background)) {
    Object.assign(v, { "--background": a.background, "--card": a.background, "--popover": a.background });
  }
  if (a.text && HEX.test(a.text)) {
    const bg = a.background && HEX.test(a.background) ? a.background : "var(--background)";
    Object.assign(v, {
      "--foreground": a.text, "--card-foreground": a.text, "--popover-foreground": a.text,
      "--subtle": `color-mix(in oklch, ${a.text} 75%, ${bg})`,
      "--muted-foreground": `color-mix(in oklch, ${a.text} 58%, ${bg})`,
    });
  }
  // Borders and the muted fills follow a custom background so they don't show the theme's grays on it.
  if (a.background && HEX.test(a.background)) {
    const ink = a.text && HEX.test(a.text) ? a.text : onColor(a.background);
    Object.assign(v, {
      "--border": `color-mix(in oklch, ${ink} 12%, ${a.background})`,
      "--input": `color-mix(in oklch, ${ink} 16%, ${a.background})`,
      "--muted": `color-mix(in oklch, ${ink} 6%, ${a.background})`,
      "--secondary": `color-mix(in oklch, ${ink} 6%, ${a.background})`,
      "--accent": `color-mix(in oklch, ${ink} 8%, ${a.background})`,
    });
  }
  if (a.bubble && HEX.test(a.bubble)) Object.assign(v, { "--bubble": a.bubble, "--bubble-foreground": onColor(a.bubble) });
  return Object.keys(v).length ? (v as CSSProperties) : undefined;
}

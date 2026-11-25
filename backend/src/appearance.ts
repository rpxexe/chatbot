// How a chatbot looks and behaves on the customer's website, set from the dashboard's Customize tab. Read publicly by
// the widget (GET /api/widget/:slug), so it holds nothing secret. Unset fields fall back to the widget's defaults.
import { HttpError } from "./extract.js";

export type Appearance = {
  theme?: "auto" | "light" | "dark";
  /** Accent: launcher, send button and the "quoted from your content" rule. #rrggbb. */
  color?: string;
  /** Chat panel background, text, and the visitor's message bubble. #rrggbb; unset follows the theme. */
  background?: string;
  text?: string;
  bubble?: string;
  /** Unread-reply badge on the chat button. #rrggbb; unset = red. */
  badge?: string;
  /** The button's first-visit animation ("Ask <name>" typing in, then folding into the button). Default on. */
  intro?: boolean;
  /** Its text; unset = "Ask <title>". */
  introText?: string;
  /** "right" / "left" are the bottom corners (the original two); "top-right" / "top-left" the top ones. */
  position?: "right" | "left" | "top-right" | "top-left";
  /** Chat button icon. The SVGs live in frontend/public/widget.js and frontend/app/(site)/admin/customize.tsx. */
  icon?: (typeof ICONS)[number];
  title?: string;
  greeting?: string;
  /** Starter questions shown under the greeting. */
  suggestions?: string[];
  /** Show which article an answer was quoted from. Default on. */
  sources?: boolean;
};

const bad = (msg: string) => new HttpError(400, msg);
export const ICONS = ["chat", "bubble", "chats", "help", "headset", "bot"] as const;

/** Validates admin input. Empty strings and empty lists clear a field; unknown keys are rejected. */
export function parseAppearance(v: unknown): Appearance {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("appearance must be an object");
  const allowed = ["theme", "color", "background", "text", "bubble", "badge", "position", "icon", "title", "greeting", "suggestions", "sources", "intro", "introText"];
  const extra = Object.keys(v).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`unknown appearance field: ${extra.join(", ")}`);
  const o = v as Record<string, unknown>;
  const out: Appearance = {};
  const oneOf = <T extends string>(k: string, values: T[]) => {
    if (o[k] == null || o[k] === "") return undefined;
    if (!values.includes(o[k] as T)) throw bad(`appearance.${k} must be one of ${values.join(", ")}`);
    return o[k] as T;
  };
  const text = (k: string, max: number) => {
    if (o[k] == null) return undefined;
    if (typeof o[k] !== "string") throw bad(`appearance.${k} must be a string`);
    const s = (o[k] as string).trim();
    if (s.length > max) throw bad(`appearance.${k} is too long (max ${max})`);
    return s || undefined;
  };
  out.theme = oneOf("theme", ["auto", "light", "dark"]);
  out.position = oneOf("position", ["right", "left", "top-right", "top-left"]);
  out.icon = oneOf("icon", [...ICONS]);
  for (const k of ["color", "background", "text", "bubble", "badge"] as const) {
    const c = text(k, 7)?.toLowerCase();
    if (c && !/^#[0-9a-f]{6}$/.test(c)) throw bad(`appearance.${k} must be a #rrggbb color`);
    out[k] = c;
  }
  out.title = text("title", 60);
  out.greeting = text("greeting", 300);
  out.introText = text("introText", 40);
  if (o.suggestions != null) {
    if (!Array.isArray(o.suggestions) || !o.suggestions.every((s) => typeof s === "string")) throw bad("appearance.suggestions must be an array of strings");
    const list = o.suggestions.map((s) => s.trim()).filter(Boolean);
    if (list.length > 4 || list.some((s) => s.length > 120)) throw bad("appearance.suggestions: at most 4, each up to 120 characters");
    if (list.length) out.suggestions = list;
  }
  for (const k of ["sources", "intro"] as const) {
    if (o[k] == null) continue;
    if (typeof o[k] !== "boolean") throw bad(`appearance.${k} must be true or false`);
    out[k] = o[k] as boolean;
  }
  // Drop unset fields so the stored JSON stays minimal.
  return Object.fromEntries(Object.entries(out).filter(([, val]) => val !== undefined)) as Appearance;
}

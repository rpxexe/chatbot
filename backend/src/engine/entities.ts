// Deterministic entity extraction: regexes and fixed word lists, no ML.
//
// Opaque values (email, order ID, product code, date, price, phone) are matched first, in that order, and blanked out,
// so later patterns never re-read them: "2026-11-23" is a date, not a phone number; "jo@canada.com" is not a location.
// Word-list entities (plan, category, location) are matched last on what is left.
import { STOPWORDS, words } from "./text.js";

export type EntityKind = "order_id" | "product" | "location" | "date" | "email" | "phone" | "price" | "plan" | "category";
/** Every value found per kind, in order of appearance, deduplicated. Kinds with no value are absent. */
export type Entities = Partial<Record<EntityKind, string[]>>;

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const WEEKDAY = String.raw`(?:mon|tues|wednes|thurs|fri|satur|sun)day`;
const ORDINAL = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const AMOUNT = String.raw`\d[\d,]*(?:\.\d{1,2})?`;
const CURRENCY = String.raw`(?:usd|eur|gbp|cad|aud|inr|dollars?|euros?|pounds?|bucks)`;
const PLANS = "free|basic|starter|standard|plus|pro|premium|business|enterprise|team|family|student|personal|unlimited|monthly|annual|yearly|bronze|silver|gold|platinum";

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// "#ORD-92831", "ORD92831", "order-12345"; then "order number: A1234", "order #5521"; then a bare "#12345".
const ORDER_PREFIXED = /#?\b(?:ORD|ORDER)[-_]?\d{3,}[A-Z0-9-]*\b/gi;
const ORDER_LABELLED = /\border\b\s*(?:number|no\.?|id|#)?(?:\s+is)?\s*[:#]?\s*#?((?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{3,})\b/gi;
const ORDER_HASH = /#(\d{4,})\b/g;
const DATE = new RegExp(
  [
    String.raw`\b\d{4}-\d{1,2}-\d{1,2}\b`, // 2026-11-23
    String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b`, // 23/11/2026, 11.23.26
    String.raw`\b${ORDINAL}\s+(?:of\s+)?${MONTH}\b(?:,?\s+\d{4}\b)?`, // 23rd of November 2026
    String.raw`\b${MONTH}\.?\s+${ORDINAL}\b(?:,?\s+\d{4}\b)?`, // Nov 23, 2026
    String.raw`\b(?:today|tomorrow|tonight|yesterday)\b`,
    String.raw`\b(?:next|last|this)\s+(?:week(?:end)?|month|year|${WEEKDAY})\b`,
    String.raw`\b\d+\s+(?:days?|weeks?|months?)\s+ago\b`,
    String.raw`\bin\s+\d+\s+(?:days?|weeks?|months?)\b`,
    String.raw`\b${WEEKDAY}\b`,
  ].join("|"),
  "gi",
);
const PRICE = new RegExp(String.raw`[$€£¥₹]\s?${AMOUNT}|\b${AMOUNT}\s?${CURRENCY}\b|\b(?:usd|eur|gbp|cad|aud|inr)\s?${AMOUNT}\b`, "gi");
// Digits with spaces, dots, dashes or brackets between; kept only with 7-15 digits (E.164 maximum).
const PHONE = /(?<![\w+])\+?\(?\d[\d\s().-]{5,}\d(?!\w)/g;
// "SKU-1234"; then "model X200", "item #A55-2": a product code must contain a digit.
const PRODUCT_SKU = /\bSKU[-_]?\d[A-Z0-9-]*\b/gi;
const PRODUCT_LABELLED = /\b(?:sku|model|item|part|product)\b\s*(?:number|no\.?|#)?\s*[:#]?\s*((?=[A-Z-]*\d)[A-Z0-9][A-Z0-9-]{2,})\b/gi;
const PLAN = new RegExp(String.raw`\b(${PLANS})\s+(?:plan|tier|subscription|package|membership)s?\b`, "gi");
// shortcut: a capitalised name after "in"/"near"/"ship to" counts as a place, so cities work without a gazetteer; misreads
// names ("in Slack"). Replace with a city list or admin-defined locations if that shows up in real chats.
const PLACE = /\b(?:in|near|(?:ship(?:ping)?|deliver(?:y|ing)?|send(?:ing)?)\s+(?:it\s+)?to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/g;
const NOT_PLACE = new RegExp(String.raw`^(?:${MONTH}|${WEEKDAY}|${PLANS})$`, "i");

// Country names from the runtime's ICU data, plus common short forms.
const display = new Intl.DisplayNames("en", { type: "region" });
const COUNTRIES = new Map<string, string>();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = display.of(code)?.replace(/ SAR China$/, "");
    // Unassigned codes echo back; pseudo and grouping regions (XA, EU, UN, QO, ZZ) are not places a customer names.
    if (!name || name === code || /pseudo|unknown|union|nations|outlying/i.test(name) || code === "EZ") continue;
    COUNTRIES.set(words(name).join(" "), name);
  }
}
for (const [alias, code] of [["usa", "US"], ["america", "US"], ["united states of america", "US"], ["uk", "GB"], ["britain", "GB"],
  ["great britain", "GB"], ["england", "GB"], ["scotland", "GB"], ["wales", "GB"], ["uae", "AE"], ["turkey", "TR"], ["holland", "NL"]]) {
  COUNTRIES.set(alias, display.of(code)!);
}

type Dictionary = { phrases: [string, string][] }; // [normalised phrase, value], longest first

function dictionary(entries: Iterable<[string, string]>): Dictionary {
  return { phrases: [...entries].filter(([p]) => p).sort((a, b) => b[0].length - a[0].length) };
}

const LOCATIONS = dictionary(COUNTRIES);

export class EntityExtractor {
  private categories: Dictionary;

  /** `categories`: the knowledge base's category names, matched as whole words in any case. */
  constructor(categories: string[] = []) {
    this.categories = dictionary(categories.map((c) => [words(c).join(" "), c]));
  }

  extract(text: string): Entities {
    const found: Entities = {};
    const add = (kind: EntityKind, value: string) => {
      const list = (found[kind] ??= []);
      if (!list.includes(value)) list.push(value);
    };
    let rest = text;
    // Records each match `value` accepts and blanks it out (same length, so later indexes stay valid).
    const take = (kind: EntityKind, re: RegExp, value: (m: RegExpExecArray) => string | null) => {
      for (const m of rest.matchAll(re)) {
        const v = value(m);
        if (!v) continue;
        add(kind, v);
        rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length);
      }
    };

    take("email", EMAIL, (m) => m[0].toLowerCase());
    take("order_id", ORDER_PREFIXED, (m) => m[0].replace(/^#/, "").toUpperCase());
    take("order_id", ORDER_LABELLED, (m) => m[1].toUpperCase());
    take("order_id", ORDER_HASH, (m) => m[1]);
    take("product", PRODUCT_SKU, (m) => m[0].toUpperCase());
    take("product", PRODUCT_LABELLED, (m) => m[1].toUpperCase());
    take("date", DATE, (m) => m[0].replace(/\s+/g, " "));
    take("price", PRICE, (m) => m[0]);
    take("phone", PHONE, (m) => {
      const digits = m[0].replace(/\D/g, "").length;
      return digits >= 7 && digits <= 15 ? m[0].trim() : null;
    });
    take("plan", PLAN, (m) => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());

    const normalised = ` ${words(rest).join(" ")} `;
    for (const v of lookup(this.categories, normalised)) add("category", v);
    for (const v of lookup(LOCATIONS, normalised)) add("location", v);
    for (const m of rest.matchAll(PLACE)) {
      const place = m[1];
      const first = place.split(" ")[0];
      if (!STOPWORDS.has(first.toLowerCase()) && !NOT_PLACE.test(first) && !found.category?.includes(place)) add("location", place);
    }
    return found;
  }
}

/** Values whose phrase occurs as whole words in `text` (normalised, space-padded), in order of appearance. A phrase inside a longer match is skipped. */
function lookup(dict: Dictionary, text: string): string[] {
  const hits: { at: number; end: number; value: string }[] = [];
  for (const [phrase, value] of dict.phrases) {
    for (let at = text.indexOf(` ${phrase} `); at !== -1; at = text.indexOf(` ${phrase} `, at + 1)) {
      const end = at + phrase.length + 2;
      if (!hits.some((h) => at < h.end - 1 && end - 1 > h.at)) hits.push({ at, end, value });
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.value);
}

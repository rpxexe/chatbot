// Deterministic intent detection: admin-defined patterns, no ML.
//
// Patterns are matched as whole words in order, after stemming, with stopwords KEPT ("how much", "where are you").
// Single-word patterns of 5+ letters also match a word one typo away.
// Confidence = share of the question explained by the intent's matched patterns. Content words count 1; filler words
// count 0.2 unless some matched pattern contains them (the admin declared them meaningful, e.g. "thank you").
// So "Where are you located?" -> location 1.0, but "How much does it cost to ship to Canada?" -> pricing ~0.5,
// leaving the specific question to search.
import { editDistance, stem, STOPWORDS, words } from "./text.js";

export type Intent = { id: number; name: string; patterns: string[]; response: string | null };
export type IntentMatch = { id: number; name: string; confidence: number; matched: string[]; response: string | null };

const FILLER_WEIGHT = 0.2;

// `spellings`: every written form of a one-word pattern, for typo matching ("pricing" though it stems like "price").
type Pattern = { text: string; stems: string[]; spellings: string[] };
type Compiled = { intent: Intent; patterns: Pattern[] };

export class IntentMatcher {
  private compiled: Compiled[];

  constructor(intents: Intent[]) {
    this.compiled = intents.map((intent) => {
      // Patterns that stem the same ("cost", "costs") are one pattern, reported by their first spelling.
      const byStems = new Map<string, Pattern>();
      for (const text of intent.patterns) {
        const ws = words(text);
        const stems = ws.map(stem);
        if (!stems.length) continue;
        const k = stems.join(" ");
        const p = byStems.get(k) ?? byStems.set(k, { text, stems, spellings: [] }).get(k)!;
        if (ws.length === 1 && !p.spellings.includes(ws[0])) p.spellings.push(ws[0]);
      }
      return { intent, patterns: [...byStems.values()] };
    });
  }

  /** All intents with at least one matching pattern, best first. */
  detect(raw: string): IntentMatch[] {
    const ws = words(raw);
    const tokens = ws.map(stem);
    if (!tokens.length) return [];

    const hits: { intent: Intent; covered: boolean[]; matched: string[]; longest: number }[] = [];
    for (const { intent, patterns } of this.compiled) {
      const covered = new Array<boolean>(tokens.length).fill(false);
      const matched: string[] = [];
      let longest = 0;
      for (const p of patterns) {
        let hit = false;
        for (let i = 0; i + p.stems.length <= tokens.length; i++) {
          if (p.stems.every((s, j) => s === tokens[i + j]) || p.spellings.some((s) => typo(s, ws[i]))) {
            for (let j = 0; j < p.stems.length; j++) covered[i + j] = true;
            hit = true;
          }
        }
        if (hit) { matched.push(p.text); longest = Math.max(longest, p.stems.length); }
      }
      if (matched.length) hits.push({ intent, covered, matched, longest });
    }
    if (!hits.length) return [];

    const inPattern = tokens.map((_, i) => hits.some((h) => h.covered[i]));
    const weight = ws.map((w, i) => (STOPWORDS.has(w) && !inPattern[i] ? FILLER_WEIGHT : 1));
    const total = weight.reduce((a, b) => a + b, 0);
    const out = hits.map(({ intent, covered, matched, longest }) => ({
      id: intent.id,
      name: intent.name,
      confidence: Math.round((covered.reduce((s, c, i) => s + (c ? weight[i] : 0), 0) / total) * 1000) / 1000,
      matched,
      response: intent.response,
      content: covered.filter((c, i) => c && !STOPWORDS.has(ws[i])).length,
      longest,
    }));
    // Ties: more content words explained, then longer pattern, then name, so the order never depends on insertion.
    return out
      .sort((a, b) => b.confidence - a.confidence || b.content - a.content || b.longest - a.longest || a.name.localeCompare(b.name))
      .map(({ content, longest, ...m }) => m);
  }
}

/** One edit apart, compared as written ("pricng" vs "pricing"); stems would exaggerate the distance. */
function typo(pattern: string, word: string) {
  return pattern.length >= 5 && word.length >= 4 && pattern[0] === word[0] && editDistance(pattern, word, 1) <= 1;
}

// Starting set for every new knowledge base; admins edit, extend or delete them per knowledge base.
// Only small-talk intents carry a fixed response; business intents route to tagged FAQs/documents instead.
export const DEFAULT_INTENTS: { name: string; patterns: string[]; response: string | null }[] = [
  { name: "greeting", patterns: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "hiya"], response: "Hello! What can I help you with today?" },
  { name: "thanks", patterns: ["thanks", "thank you", "thx", "cheers", "appreciate it", "much appreciated"], response: "You're welcome! Is there anything else I can help with?" },
  { name: "goodbye", patterns: ["bye", "goodbye", "see you", "see ya", "that's all", "that is all"], response: "Goodbye, and thanks for stopping by!" },
  { name: "human_agent", patterns: ["human", "agent", "real person", "representative", "talk to someone", "speak to someone", "speak to a person", "talk to a person", "operator"], response: null },
  { name: "pricing", patterns: ["price", "prices", "pricing", "cost", "costs", "how much", "charge", "charges", "fee", "fees", "rate", "rates", "quote", "expensive", "cheap"], response: null },
  { name: "cancellation", patterns: ["cancel", "cancellation", "unsubscribe", "terminate", "stop subscription", "end subscription", "close my account"], response: null },
  { name: "refund", patterns: ["refund", "money back", "reimburse", "reimbursement", "chargeback"], response: null },
  { name: "location", patterns: ["where are you", "where is your", "located", "location", "address", "directions", "find you", "near me", "office"], response: null },
  { name: "hours", patterns: ["opening hours", "business hours", "when are you open", "what time", "open on", "close on", "closing time", "hours"], response: null },
  { name: "contact", patterns: ["contact", "phone number", "call you", "email you", "reach you", "get in touch"], response: null },
  { name: "shipping", patterns: ["shipping", "ship", "delivery", "deliver", "dispatch", "track my order", "tracking", "courier"], response: null },
  { name: "order_status", patterns: ["order status", "my order", "where is my order", "arrived", "not received", "havent received", "order number", "missing"], response: null },
  { name: "account", patterns: ["password", "log in", "login", "sign in", "sign up", "register", "my account", "username"], response: null },
  { name: "payment", patterns: ["pay", "payment", "credit card", "debit card", "paypal", "invoice", "billing"], response: null },
];

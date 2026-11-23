import { pool } from "./db.js";
import { SearchIndex, snippet, type Entry, type Signals } from "./engine/engine.js";
import { IntentMatcher, type IntentMatch } from "./engine/intents.js";
import { EntityExtractor, type Entities } from "./engine/entities.js";
import { DEFAULT_SYNONYMS } from "./engine/synonyms.js";

// Best result must score at least this to be returned as the answer. Tuned on seed data: noise <= 0.27, real hits >= 0.35.
export const MIN_SCORE = 0.3;
// Other results above this are offered as related questions.
const RELATED_SCORE = 0.15;
// An intent counts as detected from this confidence (share of the question its patterns explain).
export const INTENT_MIN = 0.3;
// An intent's fixed response beats search results from this confidence: the patterns explain most of the question.
export const INTENT_DIRECT = 0.6;
// A search score from here means the question is clearly the entry's (seed data: exact questions >= 0.78, noise <= 0.27).
export const ANSWER_SCORE = 0.6;

// Confidence bands. The bot never answers below CLARIFY: it says it found nothing rather than guess.
//   >= ANSWER   answer
//   >= CLARIFY  best matching answer + a clarification question
//   below       FALLBACK
export const ANSWER_CONFIDENCE = 0.8;
export const CLARIFY_CONFIDENCE = 0.5;
// Runner-up scoring at least this share of the best result: two entries fit about equally, so ask which was meant.
const AMBIGUOUS_RATIO = 0.9;
const FALLBACK = "I couldn't find an answer to that in our knowledge base.";

/**
 * Raw scores (search score, intent share) are not probabilities. Mapped piecewise-linearly so the tuned thresholds land on
 * the confidence bands: MIN_SCORE/INTENT_MIN 0.3 -> 0.5, ANSWER_SCORE/INTENT_DIRECT 0.6 -> 0.8, 1 -> 1.
 */
export function calibrate(raw: number) {
  const knots: [number, number][] = [[0, 0], [MIN_SCORE, CLARIFY_CONFIDENCE], [ANSWER_SCORE, ANSWER_CONFIDENCE], [1, 1]];
  const r = Math.min(Math.max(raw, 0), 1);
  const i = knots.findIndex(([x]) => r <= x);
  if (i <= 0) return knots[0][1];
  const [[x0, y0], [x1, y1]] = [knots[i - 1], knots[i]];
  return y0 + ((r - x0) / (x1 - x0)) * (y1 - y0);
}

export type Result = {
  type: "faq" | "document";
  id: number;
  documentId?: number;
  title: string;
  category: string | null;
  score: number;
  boost: number;
  signals: Signals;
  matched: string[];
};

export type ChatResult = {
  found: boolean;
  answer: string;
  score: number;
  /** Calibrated 0..1 (see calibrate). `level` is its band: high = answer, medium = answer + clarification, low = FALLBACK. */
  confidence: number;
  level: "high" | "medium" | "low";
  /** Set for medium confidence: asks the visitor to confirm the matched question. */
  clarification: string | null;
  /** `title` is what to show as the source in any client: FAQ question, document title or intent name. */
  source: { type: "faq"; id: number; title: string; question: string; category: string | null }
        | { type: "document"; id: number; documentId: number; title: string; heading: string }
        | { type: "intent"; id: number; title: string; name: string }
        | null;
  /** How the answer was chosen: fixed intent response, search, best entry tagged with the intent, or nothing. */
  via: "intent" | "search" | "intent_fallback" | "none";
  intent: Omit<IntentMatch, "response"> | null;
  intents: Omit<IntentMatch, "response">[];
  /** Order IDs, emails, dates etc. found in the message (see engine/entities.ts). */
  entities: Entities;
  related: { id: number; question: string }[];
  results: Result[];
};

type Loaded = { version: string; index: SearchIndex; intents: IntentMatcher; entities: EntityExtractor };

// shortcut: whole knowledge base held in memory per API process, rebuilt on any content change; fine to ~50k sections, beyond that prefilter candidates in Postgres first.
const cache = new Map<number, Loaded>();

async function load(kbId: number): Promise<Loaded> {
  const { rows: [kb] } = await pool.query("SELECT content_version FROM knowledge_bases WHERE id = $1", [kbId]);
  const hit = cache.get(kbId);
  if (hit && hit.version === kb.content_version) return hit;

  // Read the version first: content loaded afterwards is at least that new, so a stale cache is never kept.
  const [faqs, sections, synonyms, intents, categories] = await Promise.all([
    pool.query(
      `SELECT f.id, f.question, f.answer, f.keywords, f.intent_id, c.name AS category
         FROM faqs f LEFT JOIN categories c ON c.id = f.category_id
        WHERE f.kb_id = $1 AND f.enabled`,
      [kbId],
    ),
    pool.query(
      `SELECT s.id, s.heading, s.body, d.id AS document_id, d.title, d.intent_id, c.name AS category
         FROM sections s JOIN documents d ON d.id = s.document_id LEFT JOIN categories c ON c.id = d.category_id
        WHERE d.kb_id = $1 AND d.enabled`,
      [kbId],
    ),
    pool.query("SELECT terms FROM synonyms WHERE kb_id = $1", [kbId]),
    pool.query("SELECT id, name, patterns, response FROM intents WHERE kb_id = $1 AND enabled", [kbId]),
    pool.query("SELECT name FROM categories WHERE kb_id = $1", [kbId]),
  ]);
  const entries: Entry[] = [
    ...faqs.rows.map((f) => ({
      type: "faq" as const, id: f.id, title: f.question, keywords: f.keywords, body: f.answer, context: "", category: f.category, intentId: f.intent_id,
    })),
    ...sections.rows.map((s) => ({
      type: "document" as const, id: s.id, documentId: s.document_id, title: s.heading, keywords: [], body: s.body, context: s.title,
      category: s.category, intentId: s.intent_id,
    })),
  ];
  const loaded = {
    version: kb.content_version,
    index: new SearchIndex(entries, [...DEFAULT_SYNONYMS, ...synonyms.rows.map((r) => r.terms)]),
    intents: new IntentMatcher(intents.rows),
    entities: new EntityExtractor(categories.rows.map((r) => r.name)),
  };
  cache.set(kbId, loaded);
  return loaded;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const publicIntent = ({ response, ...m }: IntentMatch) => m;

export async function answer(message: string, kbId: number): Promise<ChatResult> {
  const { index, intents, entities } = await load(kbId);

  const detected = intents.detect(message);
  const intent = detected[0] && detected[0].confidence >= INTENT_MIN ? detected[0] : null;
  const ranked = index.search(message, 6, intent ? { id: intent.id, confidence: intent.confidence } : undefined);
  const results: Result[] = ranked.map((r) => ({
    type: r.entry.type,
    id: r.entry.id,
    documentId: r.entry.documentId,
    title: r.entry.type === "faq" ? r.entry.title : `${r.entry.context}${r.entry.title ? ` › ${r.entry.title}` : ""}`,
    category: r.entry.category,
    score: round(r.score),
    boost: round(r.boost),
    signals: Object.fromEntries(Object.entries(r.signals).map(([k, v]) => [k, round(v)])) as Signals,
    matched: r.matched,
  }));

  const top = ranked[0];
  const searchFound = !!top && top.score >= MIN_SCORE;
  // 1. A confident intent with a fixed response, or any detected one when search has nothing better.
  // 2. A search result above the threshold (intent-tagged entries already boosted).
  // 3. The best entry tagged with the detected intent, even with weak word overlap.
  const via: ChatResult["via"] =
    intent?.response && (intent.confidence >= INTENT_DIRECT || !searchFound) ? "intent"
    : searchFound ? "search"
    : intent && top?.entry.intentId === intent.id ? "intent_fallback"
    : "none";

  // Below the answer band at most: an intent tag alone (weak word match), or a runner-up nearly as good as the winner.
  const capped = (c: number) => Math.min(c, ANSWER_CONFIDENCE - 0.01);
  const confidence = round(
    via === "intent" ? calibrate(intent!.confidence)
    : via === "intent_fallback" ? capped(calibrate(intent!.confidence))
    : via === "search" && ranked[1]?.score >= AMBIGUOUS_RATIO * top.score ? capped(calibrate(top.score))
    : calibrate(top?.score ?? 0),
  );
  // Every path but "none" starts at CLARIFY or above (MIN_SCORE, INTENT_MIN both calibrate to 0.5), so `found` = band above low.
  const level: ChatResult["level"] = confidence >= ANSWER_CONFIDENCE ? "high" : confidence >= CLARIFY_CONFIDENCE ? "medium" : "low";

  const base = {
    via,
    confidence,
    level,
    intent: intent && publicIntent(intent),
    intents: detected.slice(0, 3).map(publicIntent),
    entities: entities.extract(message),
    results,
  };
  const related = (skipTop: boolean) => ranked
    .slice(skipTop ? 1 : 0)
    .filter((r) => r.entry.type === "faq" && r.score >= RELATED_SCORE)
    .slice(0, 3)
    .map((r) => ({ id: r.entry.id, question: r.entry.title }));

  if (via === "intent") {
    // Fixed small-talk replies ("Hello! What can I help you with?") need no clarification.
    return { ...base, found: true, answer: intent!.response!, score: intent!.confidence, clarification: null, source: { type: "intent", id: intent!.id, title: intent!.name, name: intent!.name }, related: related(false) };
  }
  if (via === "none") {
    return { ...base, found: false, answer: FALLBACK, score: round(top?.score ?? 0), clarification: null, source: null, related: related(false) };
  }
  const e = top.entry;
  const matchedTitle = e.type === "faq" ? e.title : e.title ? `${e.context} › ${e.title}` : e.context;
  const others = related(true);
  return {
    ...base,
    found: true,
    clarification: level === "medium"
      ? `I'm not completely sure this answers your question. Did you mean “${matchedTitle}”? If not, please rephrase${others.length ? " or pick one of the questions below" : ""}.`
      : null,
    answer: e.type === "faq" ? e.body : snippet(e.body, index.analyzeQuery(message)),
    score: round(top.score),
    source: e.type === "faq"
      ? { type: "faq", id: e.id, title: e.title, question: e.title, category: e.category }
      : { type: "document", id: e.id, documentId: e.documentId!, title: e.context, heading: e.title },
    related: others,
  };
}

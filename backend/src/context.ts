import { pool } from "./db.js";
import { answer, type ChatResult } from "./search.js";
import { STOPWORDS, words } from "./engine/text.js";

// A conversation is forgotten after this much inactivity; expired rows are deleted when new conversations start.
const TTL = "30 minutes";
// Topic words carried from turn to turn. Older ones drop off so a long chat doesn't drag its first topic along forever.
const MAX_ENTITIES = 8;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Openers that only make sense as a continuation: "what about X", "and X", "how about X", "what if X".
const OPENER = /^(?:(?:and|but|so|ok|okay)\s+)?(?:what|how)\s+about\b|^(?:and|also|same)\b|^what\s+if\b/;
const PRONOUNS = new Set(["it", "that", "this", "those", "these", "they", "them"]);

type Context = {
  previous_question: string | null;
  previous_answer: string | null;
  detected_intent: string | null;
  matched_article: ChatResult["source"];
  entities: string[];
};

export type ConversationResult = ChatResult & {
  conversationId: string;
  /** Set when the question was read as a follow-up: the earlier question and the query actually searched. */
  followUp: { previousQuestion: string | null; query: string } | null;
};

/** Content words of `s`, unstemmed and deduplicated, in order. */
export const topicWords = (s: string) => [...new Set(words(s).filter((w) => !STOPWORDS.has(w)))];

/** True when the message reads as a continuation of the previous question rather than a new one. */
export function isFollowUp(message: string) {
  const w = words(message);
  if (OPENER.test(w.join(" "))) return true;
  // "does it apply to sale items?", "how long does that take?": a pronoun with little topic of its own.
  return w.some((x) => PRONOUNS.has(x)) && topicWords(message).length <= 3;
}

/**
 * Answers `message` using the conversation's previous topic when it is a follow-up.
 * No language model: a follow-up is searched again with the previous topic words prepended.
 * That combined query is tried when the message reads like a follow-up or finds nothing alone, and used when it scores better.
 */
export async function chat(message: string, kbId: number, conversationId?: string): Promise<ConversationResult> {
  const prev = conversationId && UUID.test(conversationId) ? await load(conversationId, kbId) : null;

  const standalone = await answer(message, kbId);
  let result = standalone;
  let query: string | null = null;
  // A confident fixed intent response ("thanks", "hi") explains the message by itself.
  if (prev?.entities.length && standalone.via !== "intent" && (isFollowUp(message) || !standalone.found)) {
    const combinedQuery = `${prev.entities.join(" ")} ${message}`;
    const combined = await answer(combinedQuery, kbId);
    // The combined query is longer, so its scores run lower: it must still beat the message alone.
    // "What about international orders?" after refunds: refund FAQ 0.49 beats "Do you ship internationally?" 0.38.
    // "what about internationally?" after shipping times: "Do you ship internationally?" 0.73 alone beats 0.65.
    if (combined.found && combined.via !== "intent" && (!standalone.found || combined.score > standalone.score)) {
      result = combined;
      query = combinedQuery;
    }
  }

  // Only answers from content become the new topic. Small talk and misses keep the previous one, so
  // "refund policy?" → "thanks" → "what about international orders?" still follows up on refunds.
  const next: Context = result.found && result.via !== "intent"
    ? {
        previous_question: message,
        previous_answer: result.answer,
        detected_intent: result.intent?.name ?? null,
        matched_article: result.source,
        entities: (query ? [...new Set([...prev!.entities, ...topicWords(message)])] : topicWords(message)).slice(-MAX_ENTITIES),
      }
    : prev ?? { previous_question: null, previous_answer: null, detected_intent: null, matched_article: null, entities: [] };

  const id = await save(prev ? conversationId! : null, kbId, next);
  // Entities come from the visitor's own words, never from the previous topic prepended to a follow-up query.
  return { ...result, entities: standalone.entities, conversationId: id, followUp: query ? { previousQuestion: prev!.previous_question, query } : null };
}

async function load(id: string, kbId: number): Promise<Context | null> {
  const { rows } = await pool.query(
    `SELECT previous_question, previous_answer, detected_intent, matched_article, entities
       FROM conversations WHERE id = $1 AND kb_id = $2 AND updated_at > now() - $3::interval`,
    [id, kbId, TTL],
  );
  return rows[0] ?? null;
}

async function save(id: string | null, kbId: number, c: Context): Promise<string> {
  const values = [c.previous_question, c.previous_answer, c.detected_intent, c.matched_article, c.entities];
  if (id) {
    await pool.query(
      `UPDATE conversations SET previous_question = $2, previous_answer = $3, detected_intent = $4, matched_article = $5,
              entities = $6, updated_at = now() WHERE id = $1`,
      [id, ...values],
    );
    return id;
  }
  await pool.query("DELETE FROM conversations WHERE updated_at < now() - $1::interval", [TTL]);
  const { rows } = await pool.query(
    `INSERT INTO conversations (kb_id, previous_question, previous_answer, detected_intent, matched_article, entities)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [kbId, ...values],
  );
  return rows[0].id;
}

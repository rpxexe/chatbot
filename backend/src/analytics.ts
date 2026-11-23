// Question log and the owner's analytics report. Every visitor question is one row in `questions`.
//
// Levels follow the confidence bands (search.ts): high = answered, medium = answered with a clarification
// ("low confidence"), low = not answered. Repeats of a question are grouped by `question_key` (its normalised words),
// so "Do you accept UPI?" and "do you accept upi" count as one.
import { pool } from "./db.js";
import type { ConversationResult } from "./context.js";
import { topicWords } from "./context.js";
import { words } from "./engine/text.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `message` with each value replaced by `by`, matched case-insensitively (emails are reported lowercased). */
function replaceAll(message: string, values: string[] | undefined, by: string) {
  return (values ?? []).reduce((m, v) => m.replace(new RegExp(escape(v), "gi"), by), message);
}

/** Records one answered (or unanswered) question. Emails and phone numbers are not stored. */
export async function logQuestion(kbId: number, message: string, r: ConversationResult) {
  const { email, phone } = r.entities;
  const stored = replaceAll(replaceAll(message, email, "[email]"), phone, "[phone]");
  // Topics skip contact details and anything with a digit (order numbers, prices, dates).
  const topics = topicWords(replaceAll(replaceAll(message, email, " "), phone, " ")).filter((w) => !/\d/.test(w));
  const s = r.found && r.source && r.source.type !== "intent" ? r.source : null;
  await pool.query(
    `INSERT INTO questions (kb_id, conversation_id, message, question_key, topics, level, confidence, via, intent,
                            source_type, source_id, source_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      kbId, r.conversationId, stored, words(stored).join(" "), topics, r.level, r.confidence, r.via, r.intent?.name ?? null,
      s?.type ?? null, s ? (s.type === "faq" ? s.id : s.documentId) : null, s?.title ?? null,
    ],
  );
}

export type Report = {
  days: number;
  totals: { conversations: number; questions: number; answered: number; lowConfidence: number; unanswered: number };
  topics: { topic: string; count: number }[];
  articles: { type: "faq" | "document"; id: number; title: string; count: number }[];
  intents: { intent: string; count: number }[];
  /** Grouped by question_key, not yet reviewed, most asked first. `question` is the latest wording. */
  unanswered: { key: string; question: string; count: number; lastAsked: string }[];
  lowConfidence: { key: string; question: string; matched: string | null; count: number; lastAsked: string }[];
};

const LIST = 50;
const TOP = 10;

export async function report(kbId: number, days: number): Promise<Report> {
  const recent = "kb_id = $1 AND created_at > now() - make_interval(days => $2)";
  const q = (sql: string) => pool.query(sql, [kbId, days]).then((r) => r.rows);
  const grouped = (level: string) => q(
    `SELECT question_key AS key, (array_agg(message ORDER BY created_at DESC))[1] AS question,
            (array_agg(source_title ORDER BY created_at DESC))[1] AS matched, count(*)::int AS count, max(created_at) AS "lastAsked"
       FROM questions WHERE ${recent} AND level = '${level}' AND NOT reviewed
      GROUP BY question_key ORDER BY count DESC, "lastAsked" DESC LIMIT ${LIST}`,
  );
  const [[totals], topics, articles, intents, unanswered, lowConfidence] = await Promise.all([
    q(`SELECT count(DISTINCT conversation_id)::int AS conversations, count(*)::int AS questions,
              count(*) FILTER (WHERE level = 'high')::int AS answered,
              count(*) FILTER (WHERE level = 'medium')::int AS "lowConfidence",
              count(*) FILTER (WHERE level = 'low')::int AS unanswered
         FROM questions WHERE ${recent}`),
    q(`SELECT t AS topic, count(*)::int AS count FROM questions, unnest(topics) AS t WHERE ${recent}
        GROUP BY t ORDER BY count DESC, t LIMIT ${TOP}`),
    q(`SELECT source_type AS type, source_id AS id, (array_agg(source_title ORDER BY created_at DESC))[1] AS title, count(*)::int AS count
         FROM questions WHERE ${recent} AND source_type IS NOT NULL
        GROUP BY source_type, source_id ORDER BY count DESC, title LIMIT ${TOP}`),
    q(`SELECT intent, count(*)::int AS count FROM questions WHERE ${recent} AND intent IS NOT NULL
        GROUP BY intent ORDER BY count DESC, intent LIMIT ${TOP}`),
    grouped("low"),
    grouped("medium"),
  ]);
  return { days, totals, topics, articles, intents, unanswered: unanswered.map(({ matched, ...u }) => u), lowConfidence };
}

/** Hides a question from the unanswered and low-confidence lists (e.g. once an FAQ covers it). Returns rows changed. */
export async function markReviewed(kbId: number, key: string) {
  const { rowCount } = await pool.query("UPDATE questions SET reviewed = true WHERE kb_id = $1 AND question_key = $2 AND NOT reviewed", [kbId, key]);
  return rowCount ?? 0;
}

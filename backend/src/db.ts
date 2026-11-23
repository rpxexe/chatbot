import pg from "pg";
import { migrations } from "./schema.js";
import { DEFAULT_INTENTS } from "./engine/intents.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://chatbot:chatbot@localhost:5432/chatbot",
});

type Db = pg.Pool | pg.PoolClient;

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise concurrent boots (e.g. server + seed) so each migration runs once.
    await client.query("SELECT pg_advisory_xact_lock(7262021)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const { rows } = await client.query("SELECT coalesce(max(version), 0) AS v FROM schema_migrations");
    for (let v = rows[0].v + 1; v <= migrations.length; v++) {
      await client.query(migrations[v - 1]);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [v]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function categoryId(db: Db, kbId: number, name?: string | null) {
  if (!name) return null;
  const { rows } = await db.query(
    `INSERT INTO categories (kb_id, name) VALUES ($1, $2)
     ON CONFLICT (kb_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [kbId, name],
  );
  return rows[0].id as number;
}

export async function insertDefaultIntents(db: Db, kbId: number) {
  for (const i of DEFAULT_INTENTS) {
    await db.query(
      "INSERT INTO intents (kb_id, name, patterns, response) VALUES ($1, $2, $3, $4) ON CONFLICT (kb_id, name) DO NOTHING",
      [kbId, i.name, i.patterns, i.response],
    );
  }
}

export type SectionInput = { heading: string; body: string };

export async function insertDocument(
  db: Db,
  doc: {
    kbId: number; title: string; category?: string | null; sourceType: string; sourceName?: string | null; sections: SectionInput[];
    intentId?: number | null; fileKey?: string | null;
  },
) {
  const { rows } = await db.query(
    `INSERT INTO documents (kb_id, title, category_id, source_type, source_name, intent_id, file_key) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [doc.kbId, doc.title, await categoryId(db, doc.kbId, doc.category), doc.sourceType, doc.sourceName ?? null, doc.intentId ?? null, doc.fileKey ?? null],
  );
  for (const [i, s] of doc.sections.entries()) {
    await db.query(
      `INSERT INTO sections (document_id, position, heading, body) VALUES ($1, $2, $3, $4)`,
      [rows[0].id, i, s.heading, s.body],
    );
  }
  return rows[0].id as number;
}

export async function insertFaq(
  db: Db,
  f: { kbId: number; question: string; answer: string; category?: string | null; keywords: string[]; enabled?: boolean; intentId?: number | null },
) {
  const { rows } = await db.query(
    `INSERT INTO faqs (kb_id, question, answer, keywords, category_id, enabled, intent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [f.kbId, f.question, f.answer, f.keywords, await categoryId(db, f.kbId, f.category), f.enabled ?? true, f.intentId ?? null],
  );
  return rows[0].id as number;
}

// Dev only: WIPES all content in the "default" knowledge base, then loads seed-data.json into it.
// Other knowledge bases are untouched.
import { readFile } from "node:fs/promises";
import { pool, migrate, tx, insertDocument, insertFaq, insertDefaultIntents } from "./db.js";

type Seed = {
  faqs: { question: string; answer: string; category?: string; keywords?: string[]; intent?: string }[];
  documents: { title: string; category?: string; sections: { heading?: string; body: string }[] }[];
};

const data: Seed = JSON.parse(await readFile(new URL("./seed-data.json", import.meta.url), "utf8"));

await migrate();
try {
  await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO knowledge_bases (name, slug, owner_id) VALUES ('Default', 'default', 'admin')
       ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    );
    const kbId: number = rows[0].id;
    for (const t of ["faqs", "documents", "categories"]) await c.query(`DELETE FROM ${t} WHERE kb_id = $1`, [kbId]);
    await insertDefaultIntents(c, kbId); // adds missing defaults only; edited intents are kept
    const { rows: intents } = await c.query("SELECT id, name FROM intents WHERE kb_id = $1", [kbId]);
    const intentId = (name?: string) => intents.find((i) => i.name === name)?.id ?? null;
    for (const { intent, ...f } of data.faqs) await insertFaq(c, { kbId, ...f, keywords: f.keywords ?? [], intentId: intentId(intent) });
    for (const d of data.documents) {
      await insertDocument(c, {
        kbId, title: d.title, category: d.category, sourceType: "manual", sourceName: d.title,
        sections: d.sections.map((s) => ({ heading: s.heading ?? "", body: s.body })),
      });
    }
  });
  console.log(`Seeded ${data.faqs.length} FAQs, ${data.documents.length} documents into "default"`);
} finally {
  await pool.end();
}

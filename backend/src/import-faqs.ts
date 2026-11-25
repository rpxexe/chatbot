// Imports a CSV of FAQs (question, answer, category, keywords) into one chatbot, straight into the database.
// The same parser as Documents > Upload file. Questions the chatbot already has are skipped, so it can be re-run.
//   npm run import-faqs -- <chatbot slug> <file.csv>
import { readFileSync } from "node:fs";
import { pool, tx, insertFaq } from "./db.js";
import { csvToContent } from "./extract.js";

const [slug, file] = process.argv.slice(2);
if (!slug || !file) {
  console.error("Usage: npm run import-faqs -- <chatbot slug> <file.csv>");
  process.exit(1);
}

const parsed = csvToContent(readFileSync(file, "utf8"), file);
if (parsed.kind !== "faqs") throw new Error(`${file} needs question and answer columns`);

const { rows: [kb] } = await pool.query("SELECT id, name FROM knowledge_bases WHERE slug = $1", [slug]);
if (!kb) throw new Error(`no chatbot with slug "${slug}"`);

const added = await tx(async (c) => {
  const { rows } = await c.query("SELECT lower(question) AS q FROM faqs WHERE kb_id = $1", [kb.id]);
  const have = new Set(rows.map((r) => r.q as string));
  let n = 0;
  for (const f of parsed.faqs) {
    if (have.has(f.question.toLowerCase())) continue;
    await insertFaq(c, { kbId: kb.id, ...f });
    n++;
  }
  return n;
});

console.log(`${kb.name} (${slug}): added ${added} FAQs, skipped ${parsed.faqs.length - added} already there.`);
await pool.end();

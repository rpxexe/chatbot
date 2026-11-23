import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SearchIndex, snippet, type Entry } from "../src/engine/engine.js";
import { DEFAULT_SYNONYMS } from "../src/engine/synonyms.js";
import { analyze, dice, editDistance, trigrams } from "../src/engine/text.js";

const seed = JSON.parse(readFileSync(new URL("../src/seed-data.json", import.meta.url), "utf8"));
const entries: Entry[] = [
  ...seed.faqs.map((f: any, i: number) => ({ type: "faq", id: i + 1, title: f.question, keywords: f.keywords, body: f.answer, context: "", category: f.category })),
  ...seed.documents.flatMap((d: any) =>
    d.sections.map((s: any, i: number) => ({ type: "document", id: 100 + i, documentId: 1, title: s.heading, keywords: [], body: s.body, context: d.title, category: d.category })),
  ),
];
const index = new SearchIndex(entries, DEFAULT_SYNONYMS);
const top = (q: string) => index.search(q)[0];

test("text helpers", () => {
  assert.deepEqual(analyze("How do I get my money back?"), ["monei", "back"]);
  assert.equal(editDistance("refnud", "refund", 2), 1); // transposition
  assert.equal(editDistance("kitten", "sitting", 2), 3); // over max -> max + 1
  assert.equal(dice(trigrams("refund policy"), trigrams("Refund Policy!")), 1);
});

test("spec example: money back ranks the refund policy first, others well below", () => {
  const r = index.search("How do I get my money back?");
  assert.equal(r[0].entry.title, "What is your refund policy?");
  assert.ok(r[0].score >= 0.5, `score ${r[0].score}`);
  assert.ok(r[0].matched.includes("refund (synonym of money back)"));
  for (const other of r.slice(1)) assert.ok(other.score < r[0].score / 2);
});

test("each signal contributes", () => {
  const exact = top("What is your refund policy?");
  assert.equal(exact.signals.question, 1);
  assert.equal(exact.signals.phrase, 1);
  assert.equal(exact.signals.fuzzy, 1);
  assert.equal(top("money back").signals.keyword, 1);
  assert.ok(top("reimbursement").signals.keyword > 0, "synonym reaches keywords");
});

test("typos are corrected against the vocabulary", () => {
  const r = top("refnud polcy");
  assert.equal(r.entry.title, "What is your refund policy?");
  assert.ok(r.matched.some((m) => m.includes("typo: refnud")));
  assert.equal(top("pasword resett").entry.title, "How do I reset my password?");
});

test("synonyms bridge vocabulary gaps", () => {
  assert.equal(top("do you deliver overseas").entry.title, "Do you ship internationally?");
  assert.equal(top("I want to unsubscribe").entry.title, "How do I cancel my subscription?");
  const r = top("how long do you keep my data");
  assert.equal(r.entry.type, "document");
  assert.equal(r.entry.title, "Data retention");
});

test("exact wording outranks a synonym", () => {
  assert.ok(top("refund").score > top("reimbursement").score);
});

test("nothing to match returns nothing", () => {
  assert.deepEqual(index.search("the"), []);
  assert.deepEqual(index.search("what is the weather today"), []);
  assert.deepEqual(new SearchIndex([], DEFAULT_SYNONYMS).search("refund"), []);
});

test("deterministic: same query, same ranking and scores", () => {
  const a = index.search("can I pay with a credit card");
  const b = new SearchIndex(entries, DEFAULT_SYNONYMS).search("can I pay with a credit card");
  assert.deepEqual(a.map((r) => [r.entry.id, r.score]), b.map((r) => [r.entry.id, r.score]));
});

test("snippet picks the relevant sentences of a long section", () => {
  const body = "Intro sentence about nothing. ".repeat(20) + "Refunds are paid within 5 days. " + "Filler text here. ".repeat(20);
  const s = snippet(body, index.analyzeQuery("when is my refund paid"), 120);
  assert.match(s, /^Refunds are paid within 5 days\./);
  assert.ok(s.length <= 121);
});

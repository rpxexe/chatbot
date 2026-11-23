import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, markdownToSections, htmlToMarkdown, csvToContent, extract } from "../src/extract.js";

test("markdown splits on headings, strips syntax, takes H1 as title", () => {
  const md = "# Guide\nIntro **bold** [link](http://x).\n\n## Setup\n- step one\n- step two\n\n```\n# not a heading\n```\n## Empty\n";
  const r = markdownToSections(md);
  assert.equal(r.title, "Guide");
  assert.deepEqual(r.sections.map((s) => s.heading), ["Guide", "Setup"]);
  assert.equal(r.sections[0].body, "Intro bold link.");
  assert.match(r.sections[1].body, /• step one\n• step two/);
  assert.match(r.sections[1].body, /# not a heading/);
});

test("chunk keeps every word and respects max size", () => {
  const text = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`).join("\n\n") + "\n\n" + "x".repeat(5000);
  const parts = chunk(text, 500);
  assert.ok(parts.every((p) => p.length <= 500));
  assert.equal(parts.join(" ").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
});

test("html drops chrome, keeps headings and blocks", () => {
  const html = `<html><head><title>Shop FAQ</title><style>p{}</style></head><body>
    <nav>Home | About</nav><main><h1>Returns</h1><p>Return within&nbsp;30 days.</p>
    <ul><li>Unused</li><li>With receipt</li></ul><script>alert(1)</script></main><footer>© shop</footer></body></html>`;
  const { title, text } = htmlToMarkdown(html);
  assert.equal(title, "Shop FAQ");
  const s = markdownToSections(text).sections;
  assert.equal(s[0].heading, "Returns");
  assert.match(s[0].body, /Return within 30 days\./);
  assert.match(s[0].body, /• Unused\n• With receipt/);
  assert.doesNotMatch(text, /alert|Home \| About|© shop/);
});

test("csv with question/answer columns becomes FAQs", () => {
  const r = csvToContent('Question,Answer,Category,Keywords\n"Do you ship, abroad?",Yes.,Shipping,"intl; abroad"\n,missing,,\n', "faq");
  assert.deepEqual(r, { kind: "faqs", faqs: [{ question: "Do you ship, abroad?", answer: "Yes.", category: "Shipping", keywords: ["intl", "abroad"] }] });
});

test("other csv becomes one section per row", () => {
  const r = csvToContent("Product,Price,Stock\nWidget,9.99,12\n", "products");
  assert.deepEqual(r, { kind: "document", title: "products", sections: [{ heading: "Widget", body: "Price: 9.99\nStock: 12" }] });
});

test("extract rejects unknown types, empty files and corrupt PDFs", async () => {
  await assert.rejects(extract(Buffer.from("x"), "a.exe"), { status: 415 });
  await assert.rejects(extract(Buffer.from("  \n "), "a.txt"), { status: 422 });
  await assert.rejects(extract(Buffer.from("not a pdf"), "a.pdf"), { status: 422 });
});

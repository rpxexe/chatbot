// Turns uploaded files / web pages into searchable sections.
// Every format is reduced to markdown-ish text, then split on headings and chunked by size.
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseHtml, HTMLElement, TextNode, type Node } from "node-html-parser";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { SectionInput } from "./db.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type FaqRow = { question: string; answer: string; category: string | null; keywords: string[] };
export type Extracted =
  | { kind: "document"; title: string; sections: SectionInput[] }
  | { kind: "faqs"; faqs: FaqRow[] };

export const SUPPORTED = ["pdf", "docx", "txt", "md", "markdown", "csv"] as const;
const MAX_SECTION = 2000;

// ---------- text -> sections ----------

function stripMarkdown(s: string) {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ");
}

function normalize(s: string) {
  return s
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split long text into <= MAX_SECTION chunks on paragraph, then sentence, boundaries. */
export function chunk(text: string, max = MAX_SECTION): string[] {
  const out: string[] = [];
  let cur = "";
  const pieces = text.split(/\n{2,}/).flatMap((p) => (p.length > max ? p.match(new RegExp(`[^]{1,${max}}(?=\\s|$)|[^]{1,${max}}`, "g"))! : [p]));
  for (const p of pieces) {
    if (cur && cur.length + p.length + 2 > max) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

/** Markdown (or plain text) -> sections split on #-headings. Returns the first H1 as a title candidate. */
export function markdownToSections(md: string): { title: string | null; sections: SectionInput[] } {
  let title: string | null = null;
  const raw: { heading: string; lines: string[] }[] = [{ heading: "", lines: [] }];
  let inFence = false;
  for (const line of normalize(md).split("\n")) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    const h = !inFence && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (h) {
      const text = stripMarkdown(h[2]).trim();
      if (h[1].length === 1 && !title) title = text;
      raw.push({ heading: text, lines: [] });
    } else {
      raw[raw.length - 1].lines.push(line);
    }
  }
  const sections: SectionInput[] = [];
  for (const r of raw) {
    const body = normalize(stripMarkdown(r.lines.join("\n")));
    for (const part of chunk(body)) sections.push({ heading: r.heading, body: part });
  }
  return { title, sections };
}

// ---------- HTML ----------

const SKIP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "nav", "footer", "header", "aside", "form", "button", "select"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "li", "ul", "ol", "table", "tr", "br", "pre", "blockquote", "dd", "dt", "figcaption"]);

/** HTML -> markdown-ish text: headings become #-lines, block elements become paragraphs. */
export function htmlToMarkdown(html: string): { title: string | null; text: string } {
  const root = parseHtml(html, { comment: false });
  const title = root.querySelector("title")?.text.trim() || null;
  const body = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body") ?? root;
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n instanceof TextNode) { out.push(n.text.replace(/\s+/g, " ")); return; }
    if (!(n instanceof HTMLElement)) return;
    const tag = n.rawTagName?.toLowerCase() ?? "";
    if (SKIP.has(tag)) return;
    const h = /^h([1-6])$/.exec(tag);
    if (h) { out.push(`\n\n${"#".repeat(+h[1])} ${n.text.replace(/\s+/g, " ").trim()}\n\n`); return; }
    if (tag === "td" || tag === "th") { n.childNodes.forEach(walk); out.push(" | "); return; }
    const block = BLOCK.has(tag);
    if (block) out.push(tag === "li" ? "\n- " : "\n\n");
    n.childNodes.forEach(walk);
    if (block) out.push("\n\n");
  };
  walk(body);
  return { title, text: out.join("") };
}

// ---------- CSV ----------

/** CSV with question+answer columns becomes FAQs; any other CSV becomes one section per row. */
export function csvToContent(text: string, name: string): Extracted {
  let rows: Record<string, string>[];
  try {
    rows = parseCsv(text.replace(/^﻿/, ""), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw new HttpError(422, `Invalid CSV: ${(e as Error).message}`);
  }
  if (rows.length === 0) throw new HttpError(422, "CSV has no data rows");
  const cols = Object.keys(rows[0]);
  const col = (n: string) => cols.find((c) => c.toLowerCase() === n);
  const q = col("question"), a = col("answer"), c = col("category"), k = col("keywords");
  if (q && a) {
    const faqs = rows
      .filter((r) => r[q] && r[a])
      .map((r) => ({
        question: r[q],
        answer: r[a],
        category: (c && r[c]) || null,
        keywords: k && r[k] ? r[k].split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [],
      }));
    if (faqs.length === 0) throw new HttpError(422, "CSV has question/answer columns but no complete rows");
    return { kind: "faqs", faqs };
  }
  const sections = rows.map((r) => ({
    heading: r[cols[0]] ?? "",
    body: cols.slice(1).filter((h) => r[h]).map((h) => `${h}: ${r[h]}`).join("\n") || (r[cols[0]] ?? ""),
  })).filter((s) => s.body);
  return { kind: "document", title: name, sections };
}

// ---------- dispatch ----------

const stem = (name: string) => name.replace(/\.[^.]+$/, "");

export async function extract(buf: Buffer, filename: string): Promise<Extracted> {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const name = stem(filename);
  let result: Extracted;
  try {
    switch (ext) {
      case "pdf": {
        const pdf = await getDocumentProxy(new Uint8Array(buf));
        const { text } = await extractText(pdf, { mergePages: false });
        const sections = text.flatMap((page, i) => chunk(normalize(page)).map((body) => ({ heading: `Page ${i + 1}`, body })));
        result = { kind: "document", title: name, sections };
        break;
      }
      case "docx": {
        const { value } = await mammoth.convertToHtml({ buffer: buf });
        const md = markdownToSections(htmlToMarkdown(value).text);
        result = { kind: "document", title: md.title ?? name, sections: md.sections };
        break;
      }
      case "md":
      case "markdown":
      case "txt": {
        const md = markdownToSections(buf.toString("utf8"));
        result = { kind: "document", title: (ext !== "txt" && md.title) || name, sections: md.sections };
        break;
      }
      case "csv":
        result = csvToContent(buf.toString("utf8"), name);
        break;
      default:
        throw new HttpError(415, `Unsupported file type ".${ext}". Supported: ${SUPPORTED.join(", ")}`);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, `Could not read ${filename}: ${(e as Error).message}`);
  }
  if (result.kind === "document" && result.sections.length === 0) {
    throw new HttpError(422, `No text found in ${filename}${ext === "pdf" ? " (scanned PDFs need OCR, which is not supported)" : ""}`);
  }
  return result;
}

/** Content fetched from a URL, dispatched by content-type. */
export async function extractFetched(buf: Buffer, contentType: string, url: URL): Promise<Extracted> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const fallbackTitle = url.hostname + url.pathname.replace(/\/$/, "");
  if (type === "text/html" || type === "application/xhtml+xml") {
    const { title, text } = htmlToMarkdown(buf.toString("utf8"));
    const md = markdownToSections(text);
    if (md.sections.length === 0) throw new HttpError(422, "No readable text on that page (it may need JavaScript to render)");
    return { kind: "document", title: title ?? md.title ?? fallbackTitle, sections: md.sections };
  }
  const ext = type === "application/pdf" ? "pdf" : type === "text/csv" ? "csv" : type === "text/markdown" ? "md" : type.startsWith("text/") ? "txt" : null;
  if (!ext) throw new HttpError(415, `Unsupported content type "${type}" at that URL`);
  const r = await extract(buf, `${fallbackTitle.split("/").pop() || url.hostname}.${ext}`);
  return r.kind === "document" ? { ...r, title: fallbackTitle } : r;
}

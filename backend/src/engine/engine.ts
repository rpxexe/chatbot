// Deterministic retrieval: no ML, same input -> same ranking.
//
// Query pipeline:  tokenize -> drop stopwords -> stem -> fuzzy-correct unknown words -> expand synonyms
// Per entry, five 0..1 signals are combined with fixed weights (see WEIGHTS):
//   bm25      BM25F over boosted fields, as idf-weighted share of the question covered (saturated term frequency)
//   keyword   share of the question matched by the entry's curated keywords
//   phrase    longest run of consecutive question words found in order in the entry
//   question  TF-IDF cosine similarity between the question and the entry's question/heading
//   fuzzy     character-trigram similarity between the question and the entry's question/heading (typos, word order)
import { analyze, dice, editDistance, stem, STOPWORDS, trigrams, words } from "./text.js";

export type Entry = {
  type: "faq" | "document";
  id: number;              // faq id or section id
  documentId?: number;
  title: string;           // FAQ question, or section heading (falls back to document title)
  keywords: string[];
  body: string;            // FAQ answer, or section text
  context: string;         // document title for sections
  category: string | null;
  intentId?: number | null; // intent this entry is tagged with
};

export type Signals = { bm25: number; keyword: number; phrase: number; question: number; fuzzy: number };
/** `boost` is the part of `score` added because the entry is tagged with the detected intent. */
export type Ranked = { entry: Entry; score: number; signals: Signals; matched: string[]; boost: number };

// Max share of the remaining gap to 1.0 an intent tag can add (scaled by intent confidence).
// Kept below MIN_SCORE (0.3) in search.ts, so a tag alone never passes as a search match without shared words.
export const INTENT_BOOST = 0.25;

export const WEIGHTS: Signals = { bm25: 0.35, keyword: 0.2, phrase: 0.1, question: 0.2, fuzzy: 0.15 };
const SYNONYM_WEIGHT = 0.7;
const FUZZY_WEIGHT = 0.85;
const UNSEEN_WEIGHT = 0.5;
const K1 = 1.2;
const B = 0.75;

type Field = "title" | "keywords" | "body" | "context";
const BOOST: Record<Field, number> = { title: 3, keywords: 3, body: 1, context: 0.5 };
const FIELDS = Object.keys(BOOST) as Field[];

type Doc = {
  entry: Entry;
  seg: Record<Field, string[][]>;   // stemmed segments per field (each keyword is its own segment)
  tf: Map<string, number>;          // boosted term frequency
  len: number;                      // boosted length
  titleTri: Set<string>;
  titleTf: Map<string, number>;
};

type Alt = { stems: string[]; weight: number; label: string };
type Concept = { start: number; end: number; alts: Alt[] };
export type Query = { raw: string; tokens: string[]; surface: string[]; idf: number[]; concepts: Concept[]; tri: Set<string> };

const key = (stems: string[]) => stems.join(" ");

/** Count occurrences of `needle` as a contiguous run inside `hay`. */
function occurrences(hay: string[], needle: string[]) {
  let n = 0;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    n++;
  }
  return n;
}

export class SearchIndex {
  readonly docs: Doc[];
  private df = new Map<string, number>();
  private postings = new Map<string, number[]>();
  private avgLen: number;
  private meanIdf: number;
  private synonymGroups: string[][][];            // group -> member stem sequences
  private synonymLookup = new Map<string, number[]>(); // member key -> group indexes
  private vocab: string[];

  constructor(entries: Entry[], synonyms: string[][]) {
    this.docs = entries.map((entry) => {
      const title = entry.title || entry.context;
      const seg: Record<Field, string[][]> = {
        title: [analyze(title)],
        keywords: entry.keywords.map(analyze).filter((k) => k.length),
        body: [analyze(entry.body)],
        context: [analyze(entry.context)],
      };
      const tf = new Map<string, number>();
      let len = 0;
      for (const f of FIELDS) for (const s of seg[f]) for (const t of s) { tf.set(t, (tf.get(t) ?? 0) + BOOST[f]); len += BOOST[f]; }
      // What the question/fuzzy signals compare against: the FAQ question, or document title + section heading.
      const simText = entry.type === "document" ? `${entry.context} ${entry.title}` : title;
      const titleTf = new Map<string, number>();
      for (const t of analyze(simText)) titleTf.set(t, (titleTf.get(t) ?? 0) + 1);
      return { entry, seg, tf, len, titleTri: trigrams(simText), titleTf };
    });
    this.docs.forEach((d, i) => {
      for (const t of d.tf.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        (this.postings.get(t) ?? this.postings.set(t, []).get(t)!).push(i);
      }
    });
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(this.docs.length, 1);
    const idfs = [...this.df.keys()].map((t) => this.idf(t));
    this.meanIdf = idfs.length ? idfs.reduce((a, b) => a + b, 0) / idfs.length : 1;

    this.synonymGroups = synonyms.map((g) => [...new Map(g.map(analyze).filter((s) => s.length).map((s) => [key(s), s])).values()]);
    this.synonymGroups.forEach((g, gi) => g.forEach((s) => {
      const k = key(s);
      const list = this.synonymLookup.get(k) ?? [];
      if (!list.includes(gi)) list.push(gi);
      this.synonymLookup.set(k, list);
    }));
    const vocab = new Set(this.df.keys());
    for (const g of this.synonymGroups) for (const s of g) for (const t of s) vocab.add(t);
    this.vocab = [...vocab];
  }

  get size() { return this.docs.length; }

  idf(t: string) {
    const n = this.docs.length;
    const df = this.df.get(t) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  private known(t: string) {
    return this.df.has(t) || this.synonymLookup.has(t);
  }

  /** Closest vocabulary words within 1 edit (2 for words of 7+ letters), best first. */
  fuzzy(t: string): { stem: string; sim: number }[] {
    if (t.length < 4 || /^\d+$/.test(t)) return [];
    const max = t.length >= 7 ? 2 : 1;
    const out: { stem: string; sim: number; df: number }[] = [];
    for (const v of this.vocab) {
      if (v.length < 3 || v[0] !== t[0]) continue; // first-letter typos are rare; skipping them avoids many false fixes
      const d = editDistance(t, v, max);
      if (d <= max) out.push({ stem: v, sim: 1 - d / Math.max(t.length, v.length), df: this.df.get(v) ?? 0 });
    }
    return out.sort((a, b) => b.sim - a.sim || b.df - a.df || a.stem.localeCompare(b.stem)).slice(0, 2);
  }

  analyzeQuery(raw: string): Query {
    const surface = words(raw).filter((w) => !STOPWORDS.has(w));
    const tokens = surface.map(stem);
    const concepts: Concept[] = tokens.map((t, i) => {
      const alts: Alt[] = [{ stems: [t], weight: 1, label: surface[i] }];
      if (!this.known(t)) for (const f of this.fuzzy(t)) alts.push({ stems: [f.stem], weight: FUZZY_WEIGHT * f.sim, label: `${f.stem} (typo: ${surface[i]})` });
      return { start: i, end: i + 1, alts };
    });

    // Synonyms over spans of 1..3 words, using each word as typed or its fuzzy correction.
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= tokens.length; i++) {
        let combos: { stems: string[]; weight: number }[] = [{ stems: [], weight: 1 }];
        for (let j = i; j < i + len; j++) {
          combos = combos.flatMap((c) => concepts[j].alts.slice(0, 2).map((a) => ({ stems: [...c.stems, ...a.stems], weight: c.weight * a.weight })));
        }
        for (const c of combos) {
          for (const gi of this.synonymLookup.get(key(c.stems)) ?? []) {
            let concept = concepts.find((x) => x.start === i && x.end === i + len);
            if (!concept) concepts.push((concept = { start: i, end: i + len, alts: [] }));
            for (const m of this.synonymGroups[gi]) {
              if (key(m) === key(c.stems) || concept.alts.some((a) => key(a.stems) === key(m))) continue;
              concept.alts.push({ stems: m, weight: SYNONYM_WEIGHT * c.weight, label: `${m.join(" ")} (synonym of ${surface.slice(i, i + len).join(" ")})` });
            }
          }
        }
      }
    }

    // Word weights for coverage. A word the knowledge base never uses (nor any correction/synonym of it) cannot tell
    // entries apart; plain BM25 would ignore it, we keep a reduced weight so an off-topic question still scores lower.
    const idf = tokens.map((t, i) => {
      if (this.df.has(t)) return this.idf(t);
      const fixed = concepts[i].alts.find((a) => a.stems.length === 1 && this.df.has(a.stems[0]));
      if (fixed) return this.idf(fixed.stems[0]);
      const seenViaSynonym = concepts.some((c) => c.start <= i && i < c.end && c.alts.some((a) => a.stems.every((s) => this.df.has(s))));
      return seenViaSynonym ? this.meanIdf : UNSEEN_WEIGHT * this.meanIdf;
    });
    return { raw, tokens, surface, idf, concepts, tri: trigrams(raw) };
  }

  /** With `intent`, entries tagged with it are always candidates and get a boost, even if they share no words with the question. */
  search(raw: string, limit = 5, intent?: { id: number; confidence: number }): Ranked[] {
    const q = this.analyzeQuery(raw);
    const candidates = new Set<number>();
    for (const c of q.concepts) for (const a of c.alts) for (const t of a.stems) for (const i of this.postings.get(t) ?? []) candidates.add(i);
    if (intent) this.docs.forEach((d, i) => { if (d.entry.intentId === intent.id) candidates.add(i); });
    return [...candidates]
      .map((i) => {
        const d = this.docs[i];
        const r: Ranked = q.tokens.length
          ? this.score(d, q)
          : { entry: d.entry, score: 0, signals: { bm25: 0, keyword: 0, phrase: 0, question: 0, fuzzy: 0 }, matched: [], boost: 0 };
        if (intent && d.entry.intentId === intent.id) {
          r.boost = (1 - r.score) * INTENT_BOOST * intent.confidence;
          r.score += r.boost;
        }
        return r;
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || (a.entry.type === "faq" ? -1 : 1) - (b.entry.type === "faq" ? -1 : 1) || a.entry.id - b.entry.id)
      .slice(0, limit);
  }

  score(d: Doc, q: Query): Ranked {
    const n = q.tokens.length;
    const idfSum = q.idf.reduce((a, b) => a + b, 0);
    const norm = K1 * (1 - B + (B * d.len) / this.avgLen);
    const bm25Cov = new Array<number>(n).fill(0);
    const kwCov = new Array<number>(n).fill(0);
    const matched: string[] = [];

    for (const c of q.concepts) {
      let best = 0;
      let bestLabel = "";
      for (const a of c.alts) {
        let tf = 0;
        let inKeyword = false;
        for (const f of FIELDS) {
          for (const s of d.seg[f]) {
            const o = occurrences(s, a.stems);
            tf += o * BOOST[f];
            if (o && f === "keywords") inKeyword = true;
          }
        }
        if (!tf) continue;
        const v = a.weight * (tf / (tf + norm));
        if (v > best) { best = v; bestLabel = a.label; }
        if (inKeyword) for (let i = c.start; i < c.end; i++) kwCov[i] = Math.max(kwCov[i], a.weight);
      }
      if (best) {
        for (let i = c.start; i < c.end; i++) bm25Cov[i] = Math.max(bm25Cov[i], best);
        if (!matched.includes(bestLabel)) matched.push(bestLabel);
      }
    }
    const coverage = (cov: number[]) => cov.reduce((s, v, i) => s + v * q.idf[i], 0) / idfSum;

    const signals: Signals = {
      bm25: coverage(bm25Cov),
      keyword: coverage(kwCov),
      phrase: n >= 2 ? this.longestRun(d, q.tokens) / n : 0,
      question: this.cosine(d, q),
      fuzzy: dice(q.tri, d.titleTri),
    };
    // Signals that cannot apply are left out and the remaining weights rescaled.
    const applies: Record<keyof Signals, boolean> = { bm25: true, keyword: d.seg.keywords.length > 0, phrase: n >= 2, question: true, fuzzy: true };
    let total = 0;
    let wsum = 0;
    for (const k of Object.keys(WEIGHTS) as (keyof Signals)[]) {
      if (!applies[k]) continue;
      total += WEIGHTS[k] * signals[k];
      wsum += WEIGHTS[k];
    }
    return { entry: d.entry, score: total / wsum, signals, matched, boost: 0 };
  }

  /** Longest run of consecutive query stems appearing contiguously in any title/keyword/body segment. */
  private longestRun(d: Doc, tokens: string[]) {
    let best = 0;
    for (const f of ["title", "keywords", "body"] as Field[]) {
      for (const s of d.seg[f]) {
        for (let i = 0; i < tokens.length; i++) {
          for (let p = 0; p < s.length; p++) {
            let l = 0;
            while (i + l < tokens.length && p + l < s.length && tokens[i + l] === s[p + l]) l++;
            if (l > best) best = l;
          }
        }
      }
    }
    return best >= 2 ? best : 0;
  }

  /** TF-IDF cosine between the query (synonyms/corrections at their weights) and the entry's title. */
  private cosine(d: Doc, q: Query) {
    const qv = new Map<string, number>();
    for (const c of q.concepts) for (const a of c.alts) for (const t of a.stems) {
      const w = (a.weight * this.idf(t)) / a.stems.length;
      if (w > (qv.get(t) ?? 0)) qv.set(t, w);
    }
    let dot = 0;
    let tNorm = 0;
    for (const [t, tf] of d.titleTf) {
      const w = tf * this.idf(t);
      tNorm += w * w;
      dot += w * (qv.get(t) ?? 0);
    }
    // Norm over the words actually asked, so synonym expansions can raise similarity but never dilute it.
    const qNorm = Math.sqrt(q.idf.reduce((s, v) => s + v * v, 0));
    return tNorm && qNorm ? Math.min(1, dot / (Math.sqrt(tNorm) * qNorm)) : 0;
  }
}

/** Best 1-3 sentence window of `body` for the query, so long sections answer with the relevant part. */
export function snippet(body: string, q: Query, max = 500) {
  if (body.length <= max) return body;
  const stems = new Set(q.concepts.flatMap((c) => c.alts.flatMap((a) => a.stems)));
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  const hits = sentences.map((s) => analyze(s).filter((t) => stems.has(t)).length);
  let best = 0;
  hits.forEach((h, i) => { if (h > hits[best]) best = i; });
  let out = sentences[best];
  for (let i = best + 1; i < sentences.length && out.length + sentences[i].length < max; i++) out += " " + sentences[i];
  return out.length > max ? out.slice(0, max).replace(/\s+\S*$/, "") + "…" : out;
}


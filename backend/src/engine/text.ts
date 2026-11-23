import { stemmer } from "stemmer";

// Function words plus question filler ("can I get", "I want to know") that carries no topic.
// Deliberately keeps "back", "long", "off", "out", "up" out of the list: they matter in "money back", "how long", "sign up".
export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
   can could did do does doing during each few for from further had has have having he her here hers herself him himself
   his how i if in into is it its itself just me more most my myself no nor not of on once only or other our ours ourselves
   own same she should so some such than that the their theirs them themselves then there these they this those through to
   too under until very was we were what when where which while who whom why will with would you your yours yourself
   yourselves get gets got getting want wants wanted need needs please tell know like let lets im ive id youre dont cant
   wont doesnt isnt arent didnt hi hello thanks thank also really many`.split(/\s+/).filter(Boolean),
);

export function normalize(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "");
}

export function words(s: string) {
  return normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
}

export function stem(w: string) {
  return w.length <= 2 || /^\d+$/.test(w) ? w : stemmer(w);
}

/** Content words of `s`, stemmed, in order. */
export function analyze(s: string) {
  return words(s).filter((w) => !STOPWORDS.has(w)).map(stem);
}

/** Character trigrams of the content words of `s` (stopwords dropped so shared filler like "how do I" scores nothing). */
export function trigrams(s: string) {
  const t = `  ${words(s).filter((w) => !STOPWORDS.has(w)).join(" ")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Sørensen–Dice similarity of two trigram sets, 0..1. */
export function dice(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  return (2 * common) / (a.size + b.size);
}

/** Optimal-string-alignment edit distance (Levenshtein + adjacent transpositions); returns max+1 once over `max`. */
export function editDistance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

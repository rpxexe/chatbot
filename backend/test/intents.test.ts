import { test } from "node:test";
import assert from "node:assert/strict";
import { IntentMatcher, DEFAULT_INTENTS } from "../src/engine/intents.js";

const matcher = new IntentMatcher(DEFAULT_INTENTS.map((d, i) => ({ id: i + 1, ...d })));
const top = (q: string) => matcher.detect(q)[0];

test("spec examples", () => {
  assert.equal(top("How much does it cost?").name, "pricing");
  assert.equal(top("Can I cancel?").name, "cancellation");
  assert.equal(top("Where are you located?").name, "location");
  assert.equal(top("Where are you located?").confidence, 1);
  assert.deepEqual(top("How much does it cost?").matched, ["cost", "how much"]);
});

test("confidence reflects how much of the question the patterns explain", () => {
  const short = top("What are your prices?");
  const long = top("What are the prices for shipping parcels to Canada in winter?");
  assert.equal(short.name, "pricing");
  assert.ok(short.confidence >= 0.6, `short ${short.confidence}`);
  assert.ok(long.confidence < 0.4, `long ${long.confidence}`);
});

test("compound questions rank every matching intent", () => {
  const names = matcher.detect("How much does it cost to cancel?").map((m) => m.name);
  assert.deepEqual(names.slice(0, 2), ["pricing", "cancellation"]);
});

test("stemming and one-letter typos on longer words", () => {
  assert.equal(top("cancelling my plan").name, "cancellation");
  assert.equal(top("what is the pricng").name, "pricing");
  assert.equal(top("hi").name, "greeting");
  assert.equal(top("thank you so much").name, "thanks");
});

test("patterns match whole words only", () => {
  assert.equal(matcher.detect("this is shipshape").find((m) => m.name === "shipping"), undefined);
  assert.equal(matcher.detect("photograph").length, 0);
});

test("no match, empty input", () => {
  assert.deepEqual(matcher.detect("is it raining"), []);
  assert.deepEqual(matcher.detect(""), []);
  assert.deepEqual(new IntentMatcher([]).detect("price"), []);
});

test("deterministic tie-breaking", () => {
  const m = new IntentMatcher([
    { id: 1, name: "b", patterns: ["order"], response: null },
    { id: 2, name: "a", patterns: ["order"], response: null },
  ]);
  assert.deepEqual(m.detect("order").map((x) => x.name), ["a", "b"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { EntityExtractor } from "../src/engine/entities.js";
import { IntentMatcher, DEFAULT_INTENTS } from "../src/engine/intents.js";

const x = new EntityExtractor(["Billing", "Returns & Refunds"]);

test("spec example: order ID plus order_status intent", () => {
  const q = "My order #ORD-92831 hasn't arrived.";
  assert.deepEqual(x.extract(q), { order_id: ["ORD-92831"] });
  const intents = new IntentMatcher(DEFAULT_INTENTS.map((d, i) => ({ id: i + 1, ...d })));
  assert.equal(intents.detect(q)[0].name, "order_status");
});

test("order IDs in other forms", () => {
  assert.deepEqual(x.extract("order number is a12345").order_id, ["A12345"]);
  assert.deepEqual(x.extract("where is order #5521-B?").order_id, ["5521-B"]);
  assert.deepEqual(x.extract("ref #55210 please").order_id, ["55210"]);
  assert.equal(x.extract("I ordered 2 things").order_id, undefined);
});

test("email, phone, price, date", () => {
  assert.deepEqual(x.extract("email Jo.Smith@Example.com or call +1 (555) 123-4567"), {
    email: ["jo.smith@example.com"], phone: ["+1 (555) 123-4567"],
  });
  assert.deepEqual(x.extract("is it $49.99, 100 dollars or EUR 20?").price, ["$49.99", "100 dollars", "EUR 20"]);
  assert.deepEqual(x.extract("Delivered 2026-11-23, due 23rd of November 2026 or Nov 25, maybe tomorrow").date,
    ["2026-11-23", "23rd of November 2026", "Nov 25", "tomorrow"]);
});

test("earlier matches are not re-read by later patterns", () => {
  // An ISO date has 8 digits but is not a phone number; an email domain is not a location.
  assert.deepEqual(x.extract("on 2026-11-23 write to jo@canada.com"), { email: ["jo@canada.com"], date: ["2026-11-23"] });
  assert.equal(x.extract("order 12345").phone, undefined);
});

test("product, plan, category, location", () => {
  assert.deepEqual(x.extract("Is SKU-4471 or model X200 in stock?").product, ["SKU-4471", "X200"]);
  assert.deepEqual(x.extract("upgrade from the free plan to Premium tier").plan, ["Free", "Premium"]);
  assert.deepEqual(x.extract("billing question about returns refunds").category, ["Billing", "Returns & Refunds"]);
  assert.deepEqual(x.extract("Do you ship to canada or the UK? I live in New York.").location, ["Canada", "United Kingdom", "New York"]);
  assert.deepEqual(x.extract("Papua New Guinea").location, ["Papua New Guinea"]); // not also "Guinea"
});

test("no false entities from plain questions", () => {
  assert.deepEqual(x.extract("How do I log in to My Account in March?"), {});
  assert.deepEqual(x.extract("What are your opening hours?"), {});
});

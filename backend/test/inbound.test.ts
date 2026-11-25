import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { stripQuoted, verifySvix } from "../src/inbound.js";

test("svix signatures: valid, tampered, stale", () => {
  const secret = `whsec_${Buffer.from("a-test-secret-key").toString("base64")}`;
  const body = '{"type":"email.received"}';
  const ts = "1700000000";
  const sig = createHmac("sha256", Buffer.from("a-test-secret-key")).update(`msg_1.${ts}.${body}`).digest("base64");
  const now = 1700000000 * 1000;
  assert.ok(verifySvix(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, now));
  assert.ok(verifySvix(body, { id: "msg_1", timestamp: ts, signature: `v1,bad v1,${sig}` }, secret, now), "any listed signature may match");
  assert.ok(!verifySvix(`${body} `, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, now), "body changed");
  assert.ok(!verifySvix(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, now + 10 * 60_000), "too old");
  assert.ok(!verifySvix(body, { id: "msg_1", timestamp: ts }, secret, now), "no signature");
});

test("email replies keep only the new text", () => {
  assert.equal(stripQuoted("Thanks, that works!\r\n\r\nOn Tue, 25 Nov 2026 at 18:00, Shop <reply+x@in.example> wrote:\r\n> Yes, in 10 days."), "Thanks, that works!");
  assert.equal(stripQuoted("Line one\n> quoted\nLine two\n-- \nJo"), "Line one\nLine two");
  assert.equal(stripQuoted("Sure.\n\n-----Original Message-----\nFrom: Shop"), "Sure.");
});

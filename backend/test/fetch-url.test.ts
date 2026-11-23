import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedAddress } from "../src/fetch-url.js";

test("blocks private, loopback, link-local and mapped addresses; allows public ones", () => {
  for (const [ip, fam] of [["127.0.0.1", 4], ["10.1.2.3", 4], ["172.16.0.1", 4], ["192.168.1.1", 4], ["169.254.169.254", 4],
    ["::1", 6], ["fe80::1", 6], ["fd00::1", 6], ["::ffff:127.0.0.1", 6], ["::ffff:10.0.0.1", 6]] as const) {
    assert.equal(isBlockedAddress(ip, fam), true, ip);
  }
  for (const [ip, fam] of [["104.20.23.154", 4], ["172.66.147.243", 4], ["8.8.8.8", 4], ["2606:4700::6810:1", 6]] as const) {
    assert.equal(isBlockedAddress(ip, fam), false, ip);
  }
});

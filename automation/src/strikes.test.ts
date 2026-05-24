// Run with: npx tsx --test automation/src/strikes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateStrikes, roundToNearest } from "./strikes.js";

const PCTS = [3, 6, 9];
const ROUND = 1000; // $10 in cents

test("META example: 6 unique strikes around $680", () => {
  // 68_000 cents = $680
  const s = calculateStrikes(68_000, { percentages: PCTS, roundToCents: ROUND });
  assert.deepEqual(s, [62_000, 64_000, 66_000, 70_000, 72_000, 74_000]);
});

test("AAPL example: low-priced stock deduplicates colliding strikes", () => {
  // $230 prev close: ±3% = 222.9 / 237.1, both round to $220 / $240.
  // ±6% = 216.2 / 243.8, round to $220 / $240 — collide and dedupe.
  // ±9% = 209.3 / 250.7, round to $210 / $250.
  const s = calculateStrikes(23_000, { percentages: PCTS, roundToCents: ROUND });
  assert.deepEqual(s, [21_000, 22_000, 24_000, 25_000]);
});

test("includeAtTheMoney adds the rounded prev close", () => {
  const s = calculateStrikes(68_000, {
    percentages: PCTS,
    roundToCents: ROUND,
    includeAtTheMoney: true,
  });
  assert.equal(s.includes(68_000), true);
  assert.equal(s.length, 7);
});

test("roundToNearest banker rounding (Math.round semantics)", () => {
  assert.equal(roundToNearest(15_500, 1000), 16_000);
  assert.equal(roundToNearest(15_499, 1000), 15_000);
});

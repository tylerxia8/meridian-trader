import test from "node:test";
import assert from "node:assert/strict";
import { classifySettlementError } from "./settlement-error.js";

test("classifySettlementError identifies oracle stale failures", () => {
  assert.equal(classifySettlementError("custom program error: OracleStale"), "oracleStale");
});

test("classifySettlementError identifies confidence band failures", () => {
  assert.equal(classifySettlementError("AnchorError caused by account: price. Error Code: OracleConfTooWide"), "oracleConfTooWide");
});

test("classifySettlementError identifies transient transport failures", () => {
  assert.equal(classifySettlementError("RPC connection timeout"), "transport");
  assert.equal(classifySettlementError("429 rate limit exceeded"), "transport");
});

test("classifySettlementError treats unknown failures as hard errors", () => {
  assert.equal(classifySettlementError("market ticker is not configured: IBM"), "hard");
});

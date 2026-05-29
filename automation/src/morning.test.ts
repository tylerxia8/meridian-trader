import test from "node:test";
import assert from "node:assert/strict";
import { isAfterRegularOpenEt } from "./jobs/morning.js";

test("isAfterRegularOpenEt handles EDT market open", () => {
  assert.equal(isAfterRegularOpenEt(new Date("2026-05-28T13:29:00Z")), false);
  assert.equal(isAfterRegularOpenEt(new Date("2026-05-28T13:30:00Z")), true);
});

test("isAfterRegularOpenEt handles EST market open", () => {
  assert.equal(isAfterRegularOpenEt(new Date("2026-01-02T14:29:00Z")), false);
  assert.equal(isAfterRegularOpenEt(new Date("2026-01-02T14:30:00Z")), true);
});

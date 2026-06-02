import test from "node:test";
import assert from "node:assert/strict";
import { shortSignature, waitForSignatureConfirmation } from "./transaction-status";

test("shortSignature keeps recognizable ends", () => {
  assert.equal(shortSignature("1234567890abcdef"), "12345678...90abcdef");
});

test("waitForSignatureConfirmation returns confirmed statuses", async () => {
  const connection = {
    async getSignatureStatuses() {
      return { value: [{ confirmationStatus: "confirmed", confirmations: 1, err: null }] };
    },
  };

  await assert.doesNotReject(async () => {
    const result = await waitForSignatureConfirmation(connection as any, "sig", { timeoutMs: 50, pollMs: 1 });
    assert.equal(result, "confirmed");
  });
});

test("waitForSignatureConfirmation surfaces failed transactions", async () => {
  const connection = {
    async getSignatureStatuses() {
      return { value: [{ confirmationStatus: null, confirmations: null, err: { InstructionError: [0, "Custom"] } }] };
    },
  };

  await assert.rejects(
    () => waitForSignatureConfirmation(connection as any, "sig", { timeoutMs: 50, pollMs: 1 }),
    /Transaction failed/
  );
});

test("waitForSignatureConfirmation times out when status stays pending", async () => {
  const connection = {
    async getSignatureStatuses() {
      return { value: [null] };
    },
  };

  const result = await waitForSignatureConfirmation(connection as any, "sig", { timeoutMs: 5, pollMs: 1 });
  assert.equal(result, "timeout");
});

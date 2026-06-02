import type { Connection } from "@solana/web3.js";

export type ConfirmationResult = "confirmed" | "finalized" | "timeout";

interface WaitOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export async function waitForSignatureConfirmation(
  connection: Connection,
  signature: string,
  options: WaitOptions = {}
): Promise<ConfirmationResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false });
    const status = value[0];
    if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "finalized") return "finalized";
    if (status?.confirmationStatus === "confirmed" || status?.confirmations != null) return "confirmed";
    await sleep(pollMs);
  }

  return "timeout";
}

export function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

import "dotenv/config";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

export type Ticker = "AAPL" | "MSFT" | "GOOGL" | "AMZN" | "NVDA" | "META" | "TSLA";

export const TICKERS: readonly Ticker[] = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
] as const;

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function parseList(s: string): number[] {
  return s
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export interface Config {
  cluster: string;
  rpcUrl: string;
  programId: PublicKey;
  usdcMint: PublicKey;
  automationKeypairPath: string;
  /// Pyth feed id (hex, 0x-prefixed) per ticker. Resolved from PYTH_FEED_<TICKER>.
  feedIds: Record<Ticker, string>;
  /// Pyth Hermes REST endpoint for fetching previous-close prices off-chain.
  hermesUrl: string;
  strikePercentages: number[];
  strikeRoundToCents: number;
  oracleMaxStalenessSecs: number;
  /// Cron schedule strings (in node-cron format).
  morningCron: string;
  settlementCron: string;
  /// Settlement retry policy.
  settlementMaxRetries: number;
  settlementRetryDelayMs: number;
}

export function loadConfig(): Config {
  const feedIds: Partial<Record<Ticker, string>> = {};
  for (const t of TICKERS) {
    const key = `PYTH_FEED_${t}`;
    const v = process.env[key];
    if (v) feedIds[t] = v;
  }
  const missing = TICKERS.filter((t) => !feedIds[t]);
  if (missing.length) {
    // Warn but don't fail at config time — the lifecycle script may run
    // against a subset of tickers. Jobs validate per-ticker.
    console.warn(`[config] missing Pyth feed ids for: ${missing.join(", ")}`);
  }

  return {
    cluster: optional("SOLANA_CLUSTER", "devnet"),
    rpcUrl: optional("SOLANA_RPC_URL", "https://api.devnet.solana.com"),
    programId: new PublicKey(required("MERIDIAN_PROGRAM_ID")),
    usdcMint: new PublicKey(required("USDC_MINT")),
    automationKeypairPath: required("AUTOMATION_WALLET"),
    feedIds: feedIds as Record<Ticker, string>,
    hermesUrl: optional("PYTH_HERMES_URL", "https://hermes.pyth.network"),
    strikePercentages: parseList(optional("STRIKE_PERCENTAGES", "3,6,9")),
    strikeRoundToCents: Number(optional("STRIKE_ROUND_TO", "10")) * 100,
    oracleMaxStalenessSecs: Number(optional("ORACLE_MAX_STALENESS_SECS", "300")),
    morningCron: optional("MORNING_JOB_CRON", "0 8 * * 1-5"),
    settlementCron: optional("SETTLEMENT_JOB_CRON", "5 16 * * 1-5"),
    settlementMaxRetries: Number(optional("SETTLEMENT_MAX_RETRIES", "30")),
    settlementRetryDelayMs: Number(optional("SETTLEMENT_RETRY_DELAY_MS", "30000")),
  };
}

export function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

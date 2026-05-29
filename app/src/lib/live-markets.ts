import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type LiveMarket = {
  address: string;
  ticker: string;
  strikeCents: number;
  expiryTs: number;
  outcome: "unsettled" | "yesWins" | "noWins";
  yesMint: string;
  noMint: string;
  phoenixMarket: string | null;
};

export type LiveMarketStatus =
  | { kind: "live"; markets: LiveMarket[] }
  | { kind: "unavailable"; reason: string };

const DEFAULT_PUBKEY = PublicKey.default.toBase58();
const LIVE_MARKETS_TIMEOUT_MS = 8_000;

export async function fetchLiveMarkets(): Promise<LiveMarketStatus> {
  const rootEnv = readRootEnv();
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    process.env.SOLANA_RPC_URL ??
    rootEnv.NEXT_PUBLIC_SOLANA_RPC_URL ??
    rootEnv.SOLANA_RPC_URL;
  const programId =
    process.env.NEXT_PUBLIC_MERIDIAN_PROGRAM_ID ??
    process.env.MERIDIAN_PROGRAM_ID ??
    rootEnv.NEXT_PUBLIC_MERIDIAN_PROGRAM_ID ??
    rootEnv.MERIDIAN_PROGRAM_ID;
  if (!rpcUrl || !programId) {
    return { kind: "unavailable", reason: "missing RPC or program id" };
  }

  const idlPath = path.resolve(process.cwd(), "..", "target", "idl", "meridian.json");
  if (!existsSync(idlPath)) {
    return { kind: "unavailable", reason: "missing generated Anchor IDL" };
  }

  try {
    const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
    (idl as Idl & { address?: string }).address = new PublicKey(programId).toBase58();
    const connection = new Connection(rpcUrl, "confirmed");
    const publicKey = Keypair.generate().publicKey;
    const wallet = {
      publicKey,
      signTransaction: async () => {
        throw new Error("read-only provider cannot sign transactions");
      },
      signAllTransactions: async () => {
        throw new Error("read-only provider cannot sign transactions");
      },
    };
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new Program(idl, provider);
    const accounts = await withTimeout<any[]>(
      (program.account as any).market.all(),
      LIVE_MARKETS_TIMEOUT_MS,
      "timed out reading live markets"
    );
    return {
      kind: "live",
      markets: accounts.map((entry: any) => toLiveMarket(entry)),
    };
  } catch (err: any) {
    return { kind: "unavailable", reason: err?.message ?? String(err) };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    );
  });
}

function readRootEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), "..", ".env");
  if (!existsSync(envPath)) return {};
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  const parsed: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return parsed;
}

function toLiveMarket(entry: any): LiveMarket {
  const account = entry.account;
  const phoenix = account.phoenixMarket?.toBase58?.() ?? DEFAULT_PUBKEY;
  return {
    address: entry.publicKey.toBase58(),
    ticker: String.fromCharCode(...account.ticker.filter((b: number) => b !== 0)),
    strikeCents: Number(account.strikePriceUsdCents),
    expiryTs: Number(account.expiryTs),
    outcome: outcomeName(account.outcome),
    yesMint: account.yesMint.toBase58(),
    noMint: account.noMint.toBase58(),
    phoenixMarket: phoenix === DEFAULT_PUBKEY ? null : phoenix,
  };
}

function outcomeName(outcome: any): LiveMarket["outcome"] {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

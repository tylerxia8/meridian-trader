import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Outcome = "unsettled" | "yesWins" | "noWins";

type TickerStats = {
  total: number;
  active: number;
  expiredUnsettled: number;
  settled: number;
  yesWins: number;
  noWins: number;
  configuredFeed: number;
  unconfiguredFeed: number;
  phoenixLinked: number;
};

const DEFAULT_PUBKEY = PublicKey.default.toBase58();

async function main(): Promise<void> {
  const rpcUrl = envAny(["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) ?? "https://api.devnet.solana.com";
  const programId = requiredEnvAny(["MERIDIAN_PROGRAM_ID", "NEXT_PUBLIC_MERIDIAN_PROGRAM_ID"]);
  const payerPath = process.env.AUTOMATION_WALLET ?? process.env.ANCHOR_WALLET;
  const payer = payerPath ? Keypair.fromSecretKey(readKeypairBytes(payerPath)) : Keypair.generate();
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(findIdlPath(), "utf8"));
  idl.address = programId;
  const program = new Program(idl, provider) as Program;
  const configKey = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const config = await (program.account as any).config.fetch(configKey);
  const markets = await (program.account as any).market.all();
  const nowSec = Math.floor(Date.now() / 1000);
  const configuredFeeds = configuredFeedIds();

  const totals = emptyStats();
  const perTicker = new Map<string, TickerStats>();

  for (const entry of markets) {
    const account = entry.account;
    const ticker = bytesToTicker(account.ticker as number[]);
    const outcome = outcomeName(account.outcome);
    const expiry = Number(account.expiryTs);
    const feedId = feedIdBytesToHex(account.priceFeedId as number[]);
    const configuredFeed = configuredFeeds.has(feedId.toLowerCase());
    const phoenixMarket = account.phoenixMarket?.toBase58?.() ?? DEFAULT_PUBKEY;
    const stats = perTicker.get(ticker) ?? emptyStats();
    perTicker.set(ticker, stats);

    for (const bucket of [totals, stats]) {
      bucket.total += 1;
      if (configuredFeed) bucket.configuredFeed += 1;
      else bucket.unconfiguredFeed += 1;
      if (phoenixMarket !== DEFAULT_PUBKEY) bucket.phoenixLinked += 1;
      if (outcome === "unsettled") {
        if (expiry > nowSec) bucket.active += 1;
        else bucket.expiredUnsettled += 1;
      } else {
        bucket.settled += 1;
        if (outcome === "yesWins") bucket.yesWins += 1;
        else bucket.noWins += 1;
      }
    }
  }

  console.log("[demo:status] Meridian devnet status");
  console.log(`Program: ${program.programId.toBase58()}`);
  console.log(`Config:  ${configKey.toBase58()}`);
  console.log(`Admin:   ${config.admin.toBase58()}`);
  console.log(`USDC:    ${config.usdcMint.toBase58()}`);
  console.log(`Oracle:  maxStaleness=${config.maxStalenessSecs}s maxConfRatioBps=${config.maxConfRatioBps}`);
  console.log(`Admin override delay: ${config.adminOverrideDelaySecs}s`);
  console.log("");
  printStats("All markets", totals);
  console.log("");
  console.log("By ticker:");
  for (const [ticker, stats] of [...perTicker.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${ticker.padEnd(5)} active=${stats.active.toString().padStart(2)} settled=${stats.settled
        .toString()
        .padStart(2)} expiredUnsettled=${stats.expiredUnsettled.toString().padStart(2)} phoenix=${stats.phoenixLinked
        .toString()
        .padStart(2)} fakeFeed=${stats.unconfiguredFeed.toString().padStart(2)}`
    );
  }
}

function emptyStats(): TickerStats {
  return {
    total: 0,
    active: 0,
    expiredUnsettled: 0,
    settled: 0,
    yesWins: 0,
    noWins: 0,
    configuredFeed: 0,
    unconfiguredFeed: 0,
    phoenixLinked: 0,
  };
}

function printStats(label: string, stats: TickerStats): void {
  console.log(`${label}:`);
  console.log(`  total=${stats.total}`);
  console.log(`  active=${stats.active}`);
  console.log(`  settled=${stats.settled} yesWins=${stats.yesWins} noWins=${stats.noWins}`);
  console.log(`  expiredUnsettled=${stats.expiredUnsettled}`);
  console.log(`  configuredFeed=${stats.configuredFeed} fakeOrUnconfiguredFeed=${stats.unconfiguredFeed}`);
  console.log(`  phoenixLinked=${stats.phoenixLinked}`);
}

function configuredFeedIds(): Set<string> {
  const feeds = new Set<string>();
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("PYTH_FEED_") && value) feeds.add(value.toLowerCase());
  }
  return feeds;
}

function outcomeName(outcome: any): Outcome {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

function bytesToTicker(ticker: number[]): string {
  return String.fromCharCode(...ticker.filter((b) => b !== 0));
}

function feedIdBytesToHex(bytes: number[]): string {
  if (bytes.length !== 32) return "invalid";
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function findIdlPath(): string {
  const candidates = [resolve(process.cwd(), "target", "idl", "meridian.json")];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Missing target/idl/meridian.json; run anchor build");
  return found;
}

function requiredEnvAny(keys: string[]): string {
  const value = envAny(keys);
  if (!value) throw new Error(`Missing required env var: ${keys.join(" or ")}`);
  return value;
}

function envAny(keys: string[]): string | undefined {
  return keys.map((key) => process.env[key]).find((value): value is string => Boolean(value));
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

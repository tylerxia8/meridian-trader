import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type MarketRow = {
  address: PublicKey;
  ticker: string;
  strikeCents: number;
  expiryTs: number;
  outcome: "unsettled" | "yesWins" | "noWins";
  phoenixMarket: PublicKey | null;
};

const DEFAULT_PUBKEY = PublicKey.default.toBase58();

async function main(): Promise<void> {
  const rpcUrl = envAny(["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) ?? "https://api.devnet.solana.com";
  const programId = new PublicKey(requiredEnvAny(["MERIDIAN_PROGRAM_ID", "NEXT_PUBLIC_MERIDIAN_PROGRAM_ID"]));
  const endpoint = process.env.PHOENIX_ENDPOINT ?? endpointFromCluster(process.env.SOLANA_CLUSTER ?? "devnet");
  const tradeHost = process.env.TRADE_STATUS_APP_URL ?? "http://localhost:3000";
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = Keypair.generate();
  const provider = new AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(findIdlPath(), "utf8"));
  idl.address = programId.toBase58();
  const program = new Program(idl, provider) as Program;
  const nowSec = Math.floor(Date.now() / 1000);

  console.log("[tradable:status] Meridian Phoenix tradability");
  console.log(`Program:  ${programId.toBase58()}`);
  console.log(`RPC:      ${rpcUrl}`);
  console.log(`Phoenix:  ${endpoint}`);
  console.log("");

  const accounts = await (program.account as any).market.all();
  const rows = accounts.map((entry: any) => toMarketRow(entry));
  const active = rows
    .filter((market) => market.outcome === "unsettled" && market.expiryTs > nowSec)
    .sort((a, b) => a.expiryTs - b.expiryTs || a.ticker.localeCompare(b.ticker));
  const linked = active.filter((market) => market.phoenixMarket);

  console.log(`Active markets: ${active.length}`);
  console.log(`Active Phoenix-linked markets: ${linked.length}`);
  if (active.length === 0) {
    console.log("");
    console.log("No active markets are available. Run `npm run trade:demo` to create and seed one.");
    return;
  }
  if (linked.length === 0) {
    console.log("");
    console.log("No active markets are linked to Phoenix. Run `npm run trade:demo` to create a browser-tradable demo.");
    return;
  }

  let phoenixClient: Phoenix.Client | null = null;
  try {
    phoenixClient = await Phoenix.Client.create(connection, endpoint);
  } catch (err: any) {
    console.log(`Phoenix SDK unavailable: ${err?.message ?? String(err)}`);
  }

  console.log("");
  console.log("Active Phoenix-linked markets:");
  for (const market of linked) {
    const book = phoenixClient ? await readTopOfBook(phoenixClient, market.phoenixMarket!) : null;
    const canBuyYes = Boolean(book?.ask);
    const canSellYes = Boolean(book?.bid);
    const secondsLeft = market.expiryTs - nowSec;
    console.log(
      `- ${market.ticker} $${formatUsd(market.strikeCents)} ${market.address.toBase58()} expires in ${formatDuration(
        secondsLeft
      )}`
    );
    console.log(`  Phoenix: ${market.phoenixMarket!.toBase58()}`);
    console.log(`  Bid: ${book?.bid ?? "empty"}  Ask: ${book?.ask ?? "empty"}`);
    console.log(`  Actions: buy YES=${yesNo(canBuyYes)} sell YES=${yesNo(canSellYes)} buy NO=${yesNo(canSellYes)} sell NO=${yesNo(canBuyYes)}`);
    console.log(`  Open: ${tradeHost.replace(/\/$/, "")}/trade/${market.ticker}`);
  }
}

async function readTopOfBook(
  phoenixClient: Phoenix.Client,
  phoenixMarket: PublicKey
): Promise<{ bid: string | null; ask: string | null }> {
  try {
    if (!phoenixClient.markets.has(phoenixMarket.toBase58())) {
      await phoenixClient.addMarket(phoenixMarket.toBase58(), true);
    }
    const ladder = phoenixClient.getUiLadder(phoenixMarket.toBase58(), 1);
    const bid = ladder.bids[0];
    const ask = ladder.asks[0];
    return {
      bid: bid ? `$${Number(bid.price).toFixed(2)} x ${bid.quantity}` : null,
      ask: ask ? `$${Number(ask.price).toFixed(2)} x ${ask.quantity}` : null,
    };
  } catch {
    return { bid: null, ask: null };
  }
}

function toMarketRow(entry: any): MarketRow {
  const account = entry.account;
  const phoenix = account.phoenixMarket?.toBase58?.() ?? DEFAULT_PUBKEY;
  return {
    address: entry.publicKey,
    ticker: bytesToTicker(account.ticker as number[]),
    strikeCents: Number(account.strikePriceUsdCents),
    expiryTs: Number(account.expiryTs),
    outcome: outcomeName(account.outcome),
    phoenixMarket: phoenix === DEFAULT_PUBKEY ? null : new PublicKey(phoenix),
  };
}

function outcomeName(outcome: any): MarketRow["outcome"] {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

function bytesToTicker(ticker: number[]): string {
  return String.fromCharCode(...ticker.filter((b) => b !== 0));
}

function formatUsd(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function endpointFromCluster(cluster: string): string {
  if (cluster === "localnet") return "localhost";
  if (cluster === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

function findIdlPath(): string {
  const candidate = resolve(process.cwd(), "target", "idl", "meridian.json");
  if (!existsSync(candidate)) throw new Error("Missing target/idl/meridian.json; run anchor build");
  return candidate;
}

function requiredEnvAny(keys: string[]): string {
  const value = envAny(keys);
  if (!value) throw new Error(`Missing required env var: ${keys.join(" or ")}`);
  return value;
}

function envAny(keys: string[]): string | undefined {
  return keys.map((key) => process.env[key]).find((value): value is string => Boolean(value));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

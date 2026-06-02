import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_PUBKEY = PublicKey.default.toBase58();

async function main(): Promise<void> {
  const rpcUrl = envAny(["SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) ?? "https://api.devnet.solana.com";
  const programId = new PublicKey(requiredEnvAny(["MERIDIAN_PROGRAM_ID", "NEXT_PUBLIC_MERIDIAN_PROGRAM_ID"]));
  const usdcMint = new PublicKey(requiredEnv("USDC_MINT"));
  const wallet = walletPublicKey();
  const connection = new Connection(rpcUrl, "confirmed");

  const solLamports = await safeRead(() => connection.getBalance(wallet, "confirmed"));
  const usdcRaw = await safeRead(() => tokenBalance(connection, getAssociatedTokenAddressSync(usdcMint, wallet)));
  const markets = await safeRead(() => loadMarkets(connection, programId));
  const tradable = markets.value ? await safeRead(() => activeTradableMarkets(connection, markets.value!)) : { value: [], error: markets.error };
  const sol = solLamports.value == null ? null : solLamports.value / 1_000_000_000;
  const error = solLamports.error ?? usdcRaw.error ?? markets.error ?? tradable.error;

  console.log("[wallet:status] Meridian wallet readiness");
  console.log(`Wallet:   ${wallet.toBase58()}`);
  console.log(`SOL:      ${sol == null ? "unavailable" : sol.toFixed(3)}`);
  console.log(`USDC:     ${usdcRaw.value == null ? "unavailable" : formatToken(usdcRaw.value)}`);
  console.log(`Tradable: ${tradable.value?.length ?? "unavailable"}`);
  console.log("");
  console.log(`Next:     ${error ? `RPC check failed: ${shortError(error)}` : nextStep(sol, usdcRaw.value, tradable.value?.length ?? 0)}`);
  if (tradable.value && tradable.value.length > 0) {
    console.log("");
    console.log("Tradable markets:");
    for (const market of tradable.value) {
      console.log(`- ${market.ticker} > $${(market.strikeCents / 100).toFixed(0)} ${market.address}`);
    }
  }
}

async function loadMarkets(connection: Connection, programId: PublicKey): Promise<any[]> {
  const payer = Keypair.generate();
  const provider = new AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(findIdlPath(), "utf8"));
  idl.address = programId.toBase58();
  const program = new Program(idl, provider) as Program;
  const nowSec = Math.floor(Date.now() / 1000);
  const entries = await (program.account as any).market.all();
  return entries
    .map((entry: any) => {
      const account = entry.account;
      const phoenix = account.phoenixMarket?.toBase58?.() ?? DEFAULT_PUBKEY;
      return {
        address: entry.publicKey.toBase58(),
        ticker: bytesToTicker(account.ticker as number[]),
        strikeCents: Number(account.strikePriceUsdCents),
        expiryTs: Number(account.expiryTs),
        outcome: outcomeName(account.outcome),
        phoenixMarket: phoenix === DEFAULT_PUBKEY ? null : phoenix,
      };
    })
    .filter((market: any) => market.outcome === "unsettled" && market.expiryTs > nowSec && market.phoenixMarket);
}

async function activeTradableMarkets(connection: Connection, markets: any[]): Promise<any[]> {
  if (markets.length === 0) return [];
  const endpoint = process.env.PHOENIX_ENDPOINT ?? endpointFromCluster(process.env.SOLANA_CLUSTER ?? "devnet");
  let client: Phoenix.Client;
  try {
    client = await Phoenix.Client.create(connection, endpoint);
  } catch {
    return [];
  }

  const tradable: any[] = [];
  for (const market of markets) {
    try {
      if (!client.markets.has(market.phoenixMarket)) await client.addMarket(market.phoenixMarket, true);
      const ladder = client.getUiLadder(market.phoenixMarket, 1);
      if (ladder.bids[0]?.price != null && ladder.asks[0]?.price != null) tradable.push(market);
    } catch {
      // Keep the readiness command useful even if one linked book is stale or slow.
    }
  }
  return tradable;
}

function walletPublicKey(): PublicKey {
  if (process.env.WALLET_PUBLIC_KEY) return new PublicKey(process.env.WALLET_PUBLIC_KEY);
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) throw new Error("Set WALLET_PUBLIC_KEY or ANCHOR_WALLET");
  return Keypair.fromSecretKey(readKeypairBytes(walletPath)).publicKey;
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const result = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
}

async function safeRead<T>(fn: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (err: any) {
    return { value: null, error: err?.message ?? String(err) };
  }
}

function nextStep(sol: number | null, usdcRaw: bigint | null, tradableCount: number): string {
  if (sol == null || usdcRaw == null) return "rerun with a healthy RPC endpoint";
  if (sol < 0.02) return "fund the wallet with devnet SOL";
  if (usdcRaw <= 0n) return "fund the wallet with demo USDC";
  if (tradableCount === 0) return "run npm run trade:demo to create a liquid market";
  return "open /markets and trade";
}

function shortError(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 180);
}

function formatToken(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function endpointFromCluster(cluster: string): string {
  if (cluster === "localnet") return "localhost";
  if (cluster === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

function outcomeName(outcome: any): "unsettled" | "yesWins" | "noWins" {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

function bytesToTicker(ticker: number[]): string {
  return String.fromCharCode(...ticker.filter((b) => b !== 0));
}

function findIdlPath(): string {
  const candidate = resolve(process.cwd(), "target", "idl", "meridian.json");
  if (!existsSync(candidate)) throw new Error("Missing target/idl/meridian.json; run anchor build");
  return candidate;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
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

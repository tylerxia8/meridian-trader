// Phoenix integration probe.
//
// This does not create Phoenix markets; the installed SDK exposes order/read
// helpers but not a simple market-creation API. The probe answers two useful
// questions:
//   1. Can the Phoenix SDK load its configured markets for an endpoint?
//   2. Do any Meridian Market accounts have a non-default phoenix_market link?
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

const DEFAULT_PUBKEY = PublicKey.default.toBase58();

async function main(): Promise<void> {
  const endpoint = process.env.PHOENIX_ENDPOINT ?? endpointFromCluster(process.env.SOLANA_CLUSTER ?? "devnet");
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const programId = new PublicKey(requiredEnv("MERIDIAN_PROGRAM_ID"));
  const walletPath = process.env.ANCHOR_WALLET ?? process.env.AUTOMATION_WALLET;
  if (!walletPath) throw new Error("ANCHOR_WALLET or AUTOMATION_WALLET is required");

  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`[phoenix] RPC: ${rpcUrl}`);
  console.log(`[phoenix] endpoint: ${endpoint}`);

  const phoenixClient = await probePhoenixSdk(connection, endpoint);
  await probeMeridianLinks(connection, walletPath, programId, phoenixClient);
}

async function probePhoenixSdk(connection: Connection, endpoint: string): Promise<any | undefined> {
  try {
    const client = await Phoenix.Client.create(connection, endpoint);
    console.log(`[phoenix] SDK loaded ${client.markets.size} configured market(s)`);
    for (const [address] of client.markets) {
      const ladder = client.getUiLadder(address, 1);
      console.log(
        `[phoenix] ${address} bid=${ladder.bids[0]?.price ?? "empty"} ask=${ladder.asks[0]?.price ?? "empty"}`
      );
    }
    return client;
  } catch (err: any) {
    console.log(`[phoenix] SDK probe failed: ${err?.message ?? String(err)}`);
    return undefined;
  }
}

async function probeMeridianLinks(
  connection: Connection,
  walletPath: string,
  programId: PublicKey,
  phoenixClient?: any
): Promise<void> {
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(readKeypairBytes(walletPath)));
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;

  const markets = await (program.account as any).market.all();
  if (markets.length === 0) {
    console.log("[phoenix] Meridian has no Market accounts on this cluster");
    return;
  }

  const linked = markets.filter((m: any) => m.account.phoenixMarket?.toBase58?.() !== DEFAULT_PUBKEY);
  console.log(`[phoenix] Meridian markets: ${markets.length}; linked Phoenix markets: ${linked.length}`);
  for (const entry of markets) {
    const ticker = String.fromCharCode(...entry.account.ticker.filter((b: number) => b !== 0));
    const strike = Number(entry.account.strikePriceUsdCents);
    const phoenix = entry.account.phoenixMarket?.toBase58?.() ?? DEFAULT_PUBKEY;
    console.log(
      `[phoenix] Meridian ${ticker} $${(strike / 100).toFixed(0)} ${entry.publicKey.toBase58()} linked=${
        phoenix === DEFAULT_PUBKEY ? "none" : phoenix
      }`
    );
  }
  for (const entry of linked) {
    const ticker = String.fromCharCode(...entry.account.ticker.filter((b: number) => b !== 0));
    const phoenix = entry.account.phoenixMarket.toBase58();
    console.log(`[phoenix] ${ticker} ${entry.publicKey.toBase58()} -> ${phoenix}`);
    if (!phoenixClient) continue;
    try {
      await phoenixClient.addMarket(phoenix, true);
      const ladder = phoenixClient.getUiLadder(phoenix, 1);
      console.log(
        `[phoenix] linked book ${phoenix} bid=${ladder.bids[0]?.price ?? "empty"} ask=${
          ladder.asks[0]?.price ?? "empty"
        }`
      );
    } catch (err: any) {
      console.log(`[phoenix] linked book ${phoenix} failed: ${err?.message ?? String(err)}`);
    }
  }
}

function endpointFromCluster(cluster: string): string {
  if (cluster === "localnet") return "localhost";
  if (cluster === "mainnet-beta") return "mainnet-beta";
  return "devnet";
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

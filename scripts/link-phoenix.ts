// Admin helper: link an existing Phoenix CLOB market to a Meridian market.
//
// Required env:
//   MERIDIAN_MARKET=<Meridian Market account pubkey>
//   PHOENIX_MARKET=<Phoenix market pubkey>
//
// This intentionally does not create Phoenix markets or validate token pairs.
// Only use it after verifying the Phoenix market trades this Meridian market's
// Yes mint against the configured quote mint.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const walletPath = requiredEnv("ANCHOR_WALLET");
  const meridianMarket = new PublicKey(requiredEnv("MERIDIAN_MARKET"));
  const phoenixMarket = new PublicKey(requiredEnv("PHOENIX_MARKET"));
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(Keypair.fromSecretKey(readKeypairBytes(walletPath)));
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

  const marketAccount = await (program.account as any).market.fetch(meridianMarket);
  const ticker = String.fromCharCode(...marketAccount.ticker.filter((b: number) => b !== 0));

  console.log(`[link-phoenix] Meridian market: ${meridianMarket.toBase58()} (${ticker})`);
  console.log(`[link-phoenix] Yes mint: ${marketAccount.yesMint.toBase58()}`);
  console.log(`[link-phoenix] Phoenix market: ${phoenixMarket.toBase58()}`);
  console.log("[link-phoenix] Submitting link_phoenix_market");

  await program.methods
    .linkPhoenixMarket(phoenixMarket)
    .accounts({
      admin: wallet.publicKey,
      config,
      market: meridianMarket,
    })
    .rpc();

  console.log("[link-phoenix] Linked.");
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

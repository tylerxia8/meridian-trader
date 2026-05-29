// Create a fresh Meridian devnet demo market.
//
// Optional env:
//   DEMO_MARKET_TICKER=META
//   DEMO_MARKET_STRIKE_CENTS=68000
//   DEMO_MARKET_EXPIRY_SECS=86400
//   DEMO_MARKET_FEED_ID=<0x-prefixed 32-byte Pyth feed id>
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { readFileSync } from "node:fs";

const FAKE_FEED_ID = Array.from({ length: 32 }, (_, i) => i + 1);

async function main(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const admin = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("ANCHOR_WALLET")));
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const configAccount = await (program.account as any).config.fetch(config);

  const ticker = tickerBytes(process.env.DEMO_MARKET_TICKER ?? "META");
  const tickerText = bytesToTicker(ticker);
  const strike = envNumber("DEMO_MARKET_STRIKE_CENTS", 68000);
  const expirySecs = envNumber("DEMO_MARKET_EXPIRY_SECS", 86400);
  const feedIdHex = process.env.DEMO_MARKET_FEED_ID ?? process.env[`PYTH_FEED_${tickerText}`];
  const feedId = feedIdHex
    ? hexToFeedIdBytes(feedIdHex)
    : FAKE_FEED_ID;
  const expiry = Math.floor(Date.now() / 1000) + expirySecs;
  const market = PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      Buffer.from(ticker),
      u64Le(strike),
      i64Le(expiry),
    ],
    program.programId
  )[0];
  const yesMint = PublicKey.findProgramAddressSync([Buffer.from("yes"), market.toBuffer()], program.programId)[0];
  const noMint = PublicKey.findProgramAddressSync([Buffer.from("no"), market.toBuffer()], program.programId)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId)[0];

  console.log(`[demo-market] Creating ${tickerText} $${(strike / 100).toFixed(2)} exp=${expiry}`);
  console.log(`[demo-market] Market: ${market.toBase58()}`);

  await program.methods
    .createStrikeMarket(ticker, new anchor.BN(strike), new anchor.BN(expiry), feedId)
    .accounts({
      admin: admin.publicKey,
      config,
      market,
      yesMint,
      noMint,
      vault,
      usdcMint: configAccount.usdcMint as PublicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([admin])
    .rpc();

  console.log(`[demo-market] Created ${market.toBase58()}`);
}

function tickerBytes(ticker: string): number[] {
  const bytes = Buffer.alloc(8);
  const source = Buffer.from(ticker.toUpperCase(), "ascii");
  if (source.length === 0 || source.length > 8) throw new Error(`Invalid ticker: ${ticker}`);
  source.copy(bytes);
  return Array.from(bytes);
}

function bytesToTicker(ticker: number[]): string {
  return String.fromCharCode(...ticker.filter((b) => b !== 0));
}

function u64Le(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function i64Le(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value));
  return buffer;
}

function hexToFeedIdBytes(hex: string): number[] {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`Invalid 32-byte feed id: ${hex}`);
  return Array.from({ length: 32 }, (_, i) => parseInt(clean.slice(i * 2, i * 2 + 2), 16));
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function envNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive numeric env var ${key}: ${value}`);
  return parsed;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Permissionless Pyth settlement smoke.
//
// Required env:
//   MERIDIAN_MARKET=<Meridian Market account pubkey>
//
// The market must have a real Pyth feed id stored in price_feed_id. This script
// waits until expiry if needed, posts a fresh PriceUpdateV2 via Hermes/Pyth
// Receiver, calls settle_market, and logs the immutable outcome.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { postPriceUpdate } from "../automation/src/pyth.js";
import { TransactionBuilder } from "@pythnetwork/solana-utils";

async function main(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const hermesUrl = process.env.PYTH_HERMES_URL ?? "https://hermes.pyth.network";
  const admin = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("ANCHOR_WALLET")));
  const market = new PublicKey(requiredEnv("MERIDIAN_MARKET"));
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const marketAccount = await (program.account as any).market.fetch(market);
  const feedId = feedIdBytesToHex(marketAccount.priceFeedId as number[]);

  console.log(`[pyth:settle] Market: ${market.toBase58()}`);
  console.log(`[pyth:settle] Feed: ${feedId}`);

  const expiry = Number(marketAccount.expiryTs);
  const now = Math.floor(Date.now() / 1000);
  if (now < expiry) {
    const waitMs = (expiry - now + 1) * 1000;
    const maxWaitMs = Number(process.env.PYTH_SETTLE_MAX_WAIT_SECS ?? "120") * 1000;
    if (waitMs > maxWaitMs) {
      throw new Error(
        `Market expires in ${Math.ceil(waitMs / 1000)}s, above PYTH_SETTLE_MAX_WAIT_SECS=${maxWaitMs / 1000}`
      );
    }
    console.log(`[pyth:settle] Waiting ${Math.ceil(waitMs / 1000)}s for market expiry`);
    await sleep(waitMs);
  }

  const posted = await postPriceUpdate(connection, provider.wallet, hermesUrl, feedId);
  await sendPythInstructions(provider, posted.postIxs);
  console.log(`[pyth:settle] PriceUpdateV2: ${posted.priceUpdateAccount.toBase58()}`);

  await program.methods
    .settleMarket()
    .accounts({
      caller: provider.wallet.publicKey,
      config,
      market,
      priceUpdate: posted.priceUpdateAccount,
    })
    .rpc();

  sendPythInstructions(provider, posted.closeIxs).catch((err) => {
    console.warn(`[pyth:settle] Price update close failed: ${err?.message ?? String(err)}`);
  });

  const settled = await (program.account as any).market.fetch(market);
  console.log(
    `[pyth:settle] Outcome=${JSON.stringify(settled.outcome)} settlement_price_usd_cents=${settled.settlementPriceUsdCents.toString()}`
  );
}

async function sendPythInstructions(
  provider: AnchorProvider,
  ixs: Array<{ instruction: anchor.web3.TransactionInstruction; signers: anchor.web3.Signer[] }>
): Promise<void> {
  if (ixs.length === 0) return;
  const builder = new TransactionBuilder(provider.wallet.publicKey, provider.connection);
  builder.addInstructions(ixs);
  const txs = builder.buildLegacyTransactions({ computeUnitPriceMicroLamports: 50_000 });
  for (const { tx, signers } of txs) {
    await provider.sendAndConfirm(tx, signers);
  }
}

function feedIdBytesToHex(bytes: number[]): string {
  if (bytes.length !== 32) throw new Error(`Invalid feed id length: ${bytes.length}`);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

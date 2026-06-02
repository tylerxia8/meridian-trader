// One-command devnet trading setup:
//   1. create a fresh Meridian market with a configured Pyth feed when available
//   2. create/link a Phoenix book
//   3. seed two-sided Phoenix liquidity via phoenix:smoke
//
// Optional env:
//   TRADE_DEMO_TICKER=META
//   TRADE_DEMO_STRIKE_CENTS=68000
//   TRADE_DEMO_EXPIRY_SECS=86400
//   TRADE_DEMO_DRY_RUN=true
import "dotenv/config";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

async function main(): Promise<void> {
  const ticker = process.env.TRADE_DEMO_TICKER ?? "META";
  const env = {
    ...process.env,
    DEMO_MARKET_TICKER: ticker,
    DEMO_MARKET_STRIKE_CENTS: process.env.TRADE_DEMO_STRIKE_CENTS ?? process.env.DEMO_MARKET_STRIKE_CENTS,
    DEMO_MARKET_EXPIRY_SECS: process.env.TRADE_DEMO_EXPIRY_SECS ?? process.env.DEMO_MARKET_EXPIRY_SECS ?? "86400",
    DEMO_MARKET_FEED_ID: process.env.TRADE_DEMO_FEED_ID ?? process.env.DEMO_MARKET_FEED_ID ?? process.env[`PYTH_FEED_${ticker}`],
  };

  if (process.env.TRADE_DEMO_DRY_RUN === "true") {
    console.log("[trade-demo] Dry run");
    console.log(`[trade-demo] ticker=${env.DEMO_MARKET_TICKER}`);
    console.log(`[trade-demo] strike=${env.DEMO_MARKET_STRIKE_CENTS ?? "script default"}`);
    console.log(`[trade-demo] expirySecs=${env.DEMO_MARKET_EXPIRY_SECS}`);
    console.log(`[trade-demo] feed=${env.DEMO_MARKET_FEED_ID ? "configured" : "fake fallback"}`);
    console.log("[trade-demo] would run: npm run demo:market");
    console.log("[trade-demo] would run: MERIDIAN_MARKET=<created> npm run phoenix:create");
    console.log("[trade-demo] would run: MERIDIAN_MARKET=<created> npm run phoenix:smoke");
    return;
  }

  await preflight(env);

  console.log(`[trade-demo] Creating Meridian market for ${ticker}`);
  const create = run("npm", ["run", "demo:market"], env);
  const market = parseMarket(create.stdout);
  console.log(`[trade-demo] Meridian market: ${market}`);

  console.log("[trade-demo] Creating and linking Phoenix market");
  run("npm", ["run", "phoenix:create"], { ...env, MERIDIAN_MARKET: market });

  console.log("[trade-demo] Seeding two-sided Phoenix liquidity");
  run("npm", ["run", "phoenix:smoke"], { ...env, MERIDIAN_MARKET: market });

  console.log("[trade-demo] Tradable demo ready.");
  console.log(`[trade-demo] MERIDIAN_MARKET=${market}`);
  console.log("[trade-demo] Open /markets or /trade/" + ticker);
}

async function preflight(env: NodeJS.ProcessEnv): Promise<void> {
  const rpcUrl = requiredEnv(env, "SOLANA_RPC_URL");
  requiredEnv(env, "MERIDIAN_PROGRAM_ID");
  const walletPath = requiredEnv(env, "ANCHOR_WALLET");
  const usdcMint = new PublicKey(requiredEnv(env, "USDC_MINT"));
  if (!existsSync("target/idl/meridian.json")) {
    throw new Error("Missing target/idl/meridian.json; run anchor build before trade:demo.");
  }
  if (!existsSync(walletPath)) {
    throw new Error(`ANCHOR_WALLET file not found: ${walletPath}`);
  }

  const admin = Keypair.fromSecretKey(readKeypairBytes(walletPath));
  const connection = new Connection(rpcUrl, "confirmed");
  const minSol = envNumber(env, "TRADE_DEMO_MIN_SOL", 0.25);
  const solBalance = (await connection.getBalance(admin.publicKey, "confirmed")) / 1_000_000_000;
  if (solBalance < minSol) {
    throw new Error(
      `Admin wallet has ${solBalance.toFixed(3)} SOL; trade:demo expects at least ${minSol} SOL for Phoenix setup.`
    );
  }

  const userUsdc = getAssociatedTokenAddressSync(usdcMint, admin.publicKey);
  const requiredUsdc = BigInt(Math.ceil(envNumber(env, "PHOENIX_SMOKE_USDC_UNITS", 1) * 1_000_000));
  const usdcBalance = await tokenBalance(connection, userUsdc);
  if (usdcBalance < requiredUsdc) {
    throw new Error(
      `Admin USDC ATA ${userUsdc.toBase58()} has ${usdcBalance} raw units; needs ${requiredUsdc}. Fund demo USDC before trade:demo.`
    );
  }

  console.log(`[trade-demo] Preflight passed for admin ${admin.publicKey.toBase58()}`);
  console.log(`[trade-demo] Admin balance: ${solBalance.toFixed(3)} SOL, ${usdcBalance} raw demo USDC`);
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    const result = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(result.value.amount);
  } catch {
    return 0n;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function envNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive numeric env var ${key}: ${value}`);
  return parsed;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

function parseMarket(output: string): string {
  const match = output.match(/\[demo-market\] Created ([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (!match?.[1]) throw new Error("Could not parse created Meridian market from demo:market output");
  return match[1];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

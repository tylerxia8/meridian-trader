// Lifecycle readiness and devnet smoke runner for the PRD-required
// create -> mint -> holder transfer -> settle -> redeem demo.
//
// The script always runs preflight checks first. When they pass, it performs
// the parts that are possible with the current deployment:
//   1. initialize config if missing
//   2. create a short-lived demo market
//   3. mint/redeem a matched pair if the admin wallet already has demo USDC
//   4. settle via delayed admin_settle so demos do not depend on live Pyth data
//
// Phoenix CLOB smoke is covered by scripts/phoenix-smoke.ts once a market is
// created and linked for the strike.
import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

type DemoMarket = {
  ticker: number[];
  strike: BN;
  expiry: BN;
  market: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  vault: PublicKey;
};

type WinningYesTransfer = {
  holder: Keypair;
  holderUsdc: PublicKey;
  holderYes: PublicKey;
  holderUsdcBefore: bigint;
  amount: bigint;
} | null;

const REQUIRED_ENV = [
  "SOLANA_RPC_URL",
  "MERIDIAN_PROGRAM_ID",
  "USDC_MINT",
  "ANCHOR_WALLET",
  "AUTOMATION_WALLET",
] as const;

const ONE_USDC = 1_000_000n;
const FAKE_FEED_ID = Array(32).fill(0xab) as number[];

async function main(): Promise<void> {
  const checks = await runPreflight();
  printChecks(checks);

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    printNextSteps(failed);
    process.exit(1);
  }

  console.log("\n[lifecycle] Preflight passed.");
  await runTransactionDemo();
}

async function runPreflight(): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push(await commandCheck("node", ["--version"], "Node.js is available"));
  checks.push(await commandCheck("anchor", ["--version"], "Anchor CLI is available"));
  checks.push(await commandCheck("solana", ["--version"], "Solana CLI is available"));
  checks.push(await commandCheck("cargo", ["--version"], "Rust cargo is available"));

  for (const key of REQUIRED_ENV) {
    checks.push({
      name: `env:${key}`,
      ok: Boolean(process.env[key]),
      detail: process.env[key] ? "set" : "missing",
    });
  }

  checks.push(await fileCheck("target/idl/meridian.json", "Anchor IDL generated"));
  checks.push(await fileCheck("target/types/meridian.ts", "Anchor TypeScript types generated"));

  for (const key of ["ANCHOR_WALLET", "AUTOMATION_WALLET"] as const) {
    const path = process.env[key];
    checks.push(path ? await keypairCheck(path, key) : missing(`${key}:file`, "env var missing"));
  }

  if (process.env.SOLANA_RPC_URL && process.env.MERIDIAN_PROGRAM_ID) {
    checks.push(await deployedProgramCheck(process.env.SOLANA_RPC_URL, process.env.MERIDIAN_PROGRAM_ID));
  } else {
    checks.push(missing("deployment:program", "requires SOLANA_RPC_URL and MERIDIAN_PROGRAM_ID"));
  }

  return checks;
}

async function runTransactionDemo(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const programId = new PublicKey(requiredEnv("MERIDIAN_PROGRAM_ID"));
  const usdcMint = new PublicKey(requiredEnv("USDC_MINT"));
  const admin = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("ANCHOR_WALLET")));
  const automation = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("AUTOMATION_WALLET")));
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;
  const config = configPda(programId);

  console.log("\n[lifecycle] Running devnet transaction smoke demo");
  const configAccount = await ensureConfig(program, config, usdcMint, admin.publicKey);
  const market = await createDemoMarket(program, programId, config, configAccount.usdcMint ?? usdcMint, admin.publicKey);
  await maybeMintAndRedeemPair(program, connection, admin, config, market, configAccount.usdcMint ?? usdcMint);
  const winningYes = await maybeMintAndTransferWinningYes(
    program,
    connection,
    admin,
    automation,
    config,
    market,
    configAccount.usdcMint ?? usdcMint
  );
  const settled = await settleWithAdminFallback(program, market.market, config, market.expiry);
  if (settled) {
    await maybeRedeemWinningYes(program, config, market, winningYes);
    await verifySettledMarket(program, connection, market, winningYes);
  }

  console.log("[lifecycle] Phoenix CLOB trade step skipped: no live Phoenix market is linked for the demo strike.");
  console.log("[lifecycle] Smoke demo complete for config/create/mint/redeem/holder-transfer.");
}

async function ensureConfig(
  program: Program,
  config: PublicKey,
  usdcMint: PublicKey,
  admin: PublicKey
): Promise<any> {
  try {
    const existing = await (program.account as any).config.fetch(config);
    console.log(`[lifecycle] Config exists: ${config.toBase58()}`);
    return existing;
  } catch {
    const maxStaleness = Number(process.env.ORACLE_MAX_STALENESS_SECS ?? "300");
    const confRatio = Number(process.env.ORACLE_MAX_CONF_RATIO ?? "0.005");
    const maxConfRatioBps = Number.isFinite(confRatio) && confRatio < 1 ? Math.round(confRatio * 10_000) : confRatio;
    const overrideDelay = Number(
      process.env.LIFECYCLE_ADMIN_OVERRIDE_DELAY_SECS ?? process.env.ADMIN_OVERRIDE_DELAY_SECS ?? "1"
    );

    console.log(`[lifecycle] Initializing config: ${config.toBase58()}`);
    await program.methods
      .initializeConfig(maxStaleness, maxConfRatioBps, overrideDelay)
      .accounts({
        admin,
        config,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return (program.account as any).config.fetch(config);
  }
}

async function createDemoMarket(
  program: Program,
  programId: PublicKey,
  config: PublicKey,
  usdcMint: PublicKey,
  admin: PublicKey
): Promise<DemoMarket> {
  const ticker = tickerBytes(process.env.LIFECYCLE_DEMO_TICKER ?? "META");
  const strike = new BN(Number(process.env.LIFECYCLE_DEMO_STRIKE_CENTS ?? "68000"));
  const expiry = new BN(Math.floor(Date.now() / 1000) + Number(process.env.LIFECYCLE_DEMO_EXPIRY_SECS ?? "20"));
  const market = marketPda(programId, ticker, strike, expiry);
  const yesMint = mintPda(programId, "yes", market);
  const noMint = mintPda(programId, "no", market);
  const vault = vaultPda(programId, market);

  console.log(`[lifecycle] Creating demo market: ${market.toBase58()}`);
  await program.methods
    .createStrikeMarket(ticker, strike, expiry, FAKE_FEED_ID)
    .accounts({
      admin,
      config,
      market,
      yesMint,
      noMint,
      vault,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return { ticker, strike, expiry, market, yesMint, noMint, vault };
}

async function maybeMintAndRedeemPair(
  program: Program,
  connection: Connection,
  admin: Keypair,
  config: PublicKey,
  market: DemoMarket,
  usdcMint: PublicKey
): Promise<boolean> {
  const userUsdc = getAssociatedTokenAddressSync(usdcMint, admin.publicKey);
  const userYes = getAssociatedTokenAddressSync(market.yesMint, admin.publicKey);
  const userNo = getAssociatedTokenAddressSync(market.noMint, admin.publicKey);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userUsdc, admin.publicKey, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userYes, admin.publicKey, market.yesMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, userNo, admin.publicKey, market.noMint)
  );
  await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

  const balance = await tokenBalance(connection, userUsdc);
  if (balance < ONE_USDC) {
    console.log(
      `[lifecycle] Mint/redeem skipped: admin USDC ATA has ${balance} raw units; needs ${ONE_USDC}.`
    );
    console.log("[lifecycle] Fund that ATA with demo USDC to exercise mint_pair/redeem_pair.");
    return;
  }

  console.log("[lifecycle] Minting and redeeming one matched Yes/No pair");
  await program.methods
    .mintPair(new BN(ONE_USDC.toString()))
    .accounts({
      user: admin.publicKey,
      config,
      market: market.market,
      yesMint: market.yesMint,
      noMint: market.noMint,
      vault: market.vault,
      userUsdc,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([admin])
    .rpc();

  await program.methods
    .redeemPair(new BN(ONE_USDC.toString()))
    .accounts({
      user: admin.publicKey,
      config,
      market: market.market,
      yesMint: market.yesMint,
      noMint: market.noMint,
      vault: market.vault,
      userUsdc,
      userYes,
      userNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([admin])
    .rpc();
}

async function maybeMintAndTransferWinningYes(
  program: Program,
  connection: Connection,
  admin: Keypair,
  holder: Keypair,
  config: PublicKey,
  market: DemoMarket,
  usdcMint: PublicKey
): Promise<WinningYesTransfer> {
  const adminUsdc = getAssociatedTokenAddressSync(usdcMint, admin.publicKey);
  const adminYes = getAssociatedTokenAddressSync(market.yesMint, admin.publicKey);
  const adminNo = getAssociatedTokenAddressSync(market.noMint, admin.publicKey);
  const holderUsdc = getAssociatedTokenAddressSync(usdcMint, holder.publicKey);
  const holderYes = getAssociatedTokenAddressSync(market.yesMint, holder.publicKey);

  const setupTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminUsdc, admin.publicKey, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminYes, admin.publicKey, market.yesMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminNo, admin.publicKey, market.noMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, holderUsdc, holder.publicKey, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, holderYes, holder.publicKey, market.yesMint)
  );
  await sendAndConfirmTransaction(connection, setupTx, [admin], { commitment: "confirmed" });

  const balance = await tokenBalance(connection, adminUsdc);
  if (balance < ONE_USDC) {
    console.log(
      `[lifecycle] Winning-token transfer skipped: admin USDC ATA has ${balance} raw units; needs ${ONE_USDC}.`
    );
    return null;
  }

  console.log("[lifecycle] Minting one pair and transferring Yes to the automation wallet");
  await program.methods
    .mintPair(new BN(ONE_USDC.toString()))
    .accounts({
      user: admin.publicKey,
      config,
      market: market.market,
      yesMint: market.yesMint,
      noMint: market.noMint,
      vault: market.vault,
      userUsdc: adminUsdc,
      userYes: adminYes,
      userNo: adminNo,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([admin])
    .rpc();

  const transferTx = new Transaction().add(
    createTransferCheckedInstruction(
      adminYes,
      market.yesMint,
      holderYes,
      admin.publicKey,
      ONE_USDC,
      6,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  await sendAndConfirmTransaction(connection, transferTx, [admin], { commitment: "confirmed" });
  return {
    holder,
    holderUsdc,
    holderYes,
    holderUsdcBefore: await tokenBalance(connection, holderUsdc),
    amount: ONE_USDC,
  };
}

async function maybeRedeemWinningYes(
  program: Program,
  config: PublicKey,
  market: DemoMarket,
  winningYes: WinningYesTransfer
): Promise<void> {
  if (!winningYes) return;

  console.log("[lifecycle] Redeeming winning Yes from the automation wallet");
  await program.methods
    .redeemYes(new BN(winningYes.amount.toString()))
    .accounts({
      user: winningYes.holder.publicKey,
      config,
      market: market.market,
      yesMint: market.yesMint,
      vault: market.vault,
      userUsdc: winningYes.holderUsdc,
      userYes: winningYes.holderYes,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([winningYes.holder])
    .rpc();
}

async function verifySettledMarket(
  program: Program,
  connection: Connection,
  market: DemoMarket,
  winningYes: WinningYesTransfer
): Promise<void> {
  const account = await (program.account as any).market.fetch(market.market);
  if (!("yesWins" in account.outcome)) {
    throw new Error(`expected YesWins outcome, got ${JSON.stringify(account.outcome)}`);
  }
  if (Number(account.settlementPriceUsdCents) <= 0) {
    throw new Error("expected non-zero settlement price");
  }

  if (winningYes) {
    const holderYesAfter = await tokenBalance(connection, winningYes.holderYes);
    const holderUsdcAfter = await tokenBalance(connection, winningYes.holderUsdc);
    if (holderYesAfter !== 0n) {
      throw new Error(`expected holder Yes balance to be 0 after redemption, got ${holderYesAfter}`);
    }
    const expectedUsdc = winningYes.holderUsdcBefore + winningYes.amount;
    if (holderUsdcAfter !== expectedUsdc) {
      throw new Error(`expected holder USDC ${expectedUsdc} after redemption, got ${holderUsdcAfter}`);
    }
  }

  console.log("[lifecycle] Verified YesWins outcome and winning-holder redemption balances.");
}

async function settleWithAdminFallback(
  program: Program,
  market: PublicKey,
  config: PublicKey,
  expiry: BN
): Promise<void> {
  const cfg = await (program.account as any).config.fetch(config);
  const delaySecs = Number(cfg.adminOverrideDelaySecs ?? 0);
  const earliest = expiry.toNumber() + delaySecs;
  const now = Math.floor(Date.now() / 1000);
  if (now < earliest) {
    const waitMs = (earliest - now + 1) * 1000;
    const maxWaitMs = Number(process.env.LIFECYCLE_MAX_WAIT_SECS ?? "120") * 1000;
    if (waitMs > maxWaitMs) {
      console.log(
        `[lifecycle] Admin settlement skipped: override delay requires waiting ${Math.ceil(
          waitMs / 1000
        )}s, above LIFECYCLE_MAX_WAIT_SECS=${Math.floor(maxWaitMs / 1000)}.`
      );
      console.log("[lifecycle] For a faster full demo, initialize a fresh program/config with LIFECYCLE_ADMIN_OVERRIDE_DELAY_SECS=1.");
      return false;
    }
    console.log(`[lifecycle] Waiting ${Math.ceil(waitMs / 1000)}s for admin_settle override delay`);
    await sleep(waitMs);
  }

  console.log("[lifecycle] Settling demo market with admin_settle fallback");
  await program.methods
    .adminSettle(new BN(Number(process.env.LIFECYCLE_DEMO_SETTLEMENT_CENTS ?? "69000")))
    .accounts({
      admin: (program.provider as AnchorProvider).wallet.publicKey,
      config,
      market,
    })
    .rpc();
  return true;
}

async function tokenBalance(connection: Connection, ata: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, ata)).amount;
  } catch {
    return 0n;
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

function tickerBytes(t: string): number[] {
  const b = Buffer.alloc(8);
  Buffer.from(t, "ascii").copy(b, 0, 0, Math.min(t.length, 8));
  return Array.from(b);
}

function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

function marketPda(programId: PublicKey, ticker: number[], strike: BN, expiry: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("market"),
      Buffer.from(ticker),
      strike.toArrayLike(Buffer, "le", 8),
      expiry.toArrayLike(Buffer, "le", 8),
    ],
    programId
  )[0];
}

function mintPda(programId: PublicKey, kind: "yes" | "no", market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(kind), market.toBuffer()], programId)[0];
}

function vaultPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], programId)[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function missing(name: string, detail: string): Check {
  return { name, ok: false, detail };
}

async function commandCheck(command: string, args: string[], successDetail: string): Promise<Check> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.stderr.on("data", (chunk) => (err += chunk.toString()));
    child.on("error", (e) => resolve({ name: `tool:${command}`, ok: false, detail: e.message }));
    child.on("close", (code) => {
      const detail = (out || err).trim().split(/\r?\n/)[0] || successDetail;
      resolve({ name: `tool:${command}`, ok: code === 0, detail });
    });
  });
}

async function fileCheck(path: string, label: string): Promise<Check> {
  try {
    await access(path);
    return { name: `file:${path}`, ok: true, detail: label };
  } catch {
    return { name: `file:${path}`, ok: false, detail: "missing; run anchor build" };
  }
}

async function keypairCheck(path: string, key: string): Promise<Check> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const ok = Array.isArray(parsed) && parsed.length === 64;
    return {
      name: `${key}:file`,
      ok,
      detail: ok ? path : `${path} is not a 64-byte Solana keypair JSON array`,
    };
  } catch (e: any) {
    return { name: `${key}:file`, ok: false, detail: e?.message ?? String(e) };
  }
}

async function deployedProgramCheck(rpcUrl: string, programId: string): Promise<Check> {
  try {
    const pubkey = new PublicKey(programId);
    const connection = new Connection(rpcUrl, "confirmed");
    const account = await connection.getAccountInfo(pubkey);
    if (!account) {
      return { name: "deployment:program", ok: false, detail: `${programId} not found on ${rpcUrl}` };
    }
    return {
      name: "deployment:program",
      ok: account.executable,
      detail: account.executable ? `executable on ${rpcUrl}` : "account exists but is not executable",
    };
  } catch (e: any) {
    return { name: "deployment:program", ok: false, detail: e?.message ?? String(e) };
  }
}

function printChecks(checks: Check[]): void {
  console.log("[lifecycle] Meridian devnet lifecycle preflight\n");
  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark.padEnd(4)} ${check.name.padEnd(38)} ${check.detail}`);
  }
}

function printNextSteps(failed: Check[]): void {
  console.log("\n[lifecycle] Not ready for the full lifecycle demo yet.");
  if (failed.some((c) => c.name.startsWith("tool:"))) {
    console.log("- Install Rust, Solana CLI, and Anchor. On Windows, WSL 2 is still the recommended path.");
  }
  if (failed.some((c) => c.name.startsWith("env:"))) {
    console.log("- Copy .env.example to .env and fill MERIDIAN_PROGRAM_ID, wallet paths, USDC_MINT, and Pyth feeds.");
  }
  if (failed.some((c) => c.name.includes("target/"))) {
    console.log("- Run anchor build to generate target/idl/meridian.json and target/types/meridian.ts.");
  }
  if (failed.some((c) => c.name.startsWith("deployment:"))) {
    console.log("- Run anchor deploy --provider.cluster devnet, then update MERIDIAN_PROGRAM_ID in .env.");
  }
  if (!existsSync("package-lock.json")) {
    console.log("- Run npm install --ignore-scripts on native Windows if dependency postinstall scripts fail.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

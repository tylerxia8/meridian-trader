// One-command local fast demo.
//
// This avoids devnet faucet and existing-config friction by using a temporary
// local validator, deploying the current program, creating a demo USDC mint,
// funding the admin wallet with demo USDC, and then running lifecycle.ts with
// a 1-second admin settlement delay.
import { createAssociatedTokenAccount, createMint, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const RPC_URL = "http://127.0.0.1:8899";
const ADMIN_WALLET = "./keypairs/admin.json";
const AUTOMATION_WALLET = "./keypairs/automation.json";
const PROGRAM_KEYPAIR = "target/deploy/meridian-keypair.json";

async function main(): Promise<void> {
  requireFile(ADMIN_WALLET);
  requireFile(AUTOMATION_WALLET);

  console.log("[fast-demo] Starting local validator");
  const validator = spawn("solana-test-validator", ["--reset", "--quiet"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForRpc();
    await run("anchor", ["build"]);
    requireFile(PROGRAM_KEYPAIR);
    const programId = keypairPubkey(PROGRAM_KEYPAIR);
    const connection = new Connection(RPC_URL, "confirmed");
    const admin = Keypair.fromSecretKey(readKeypairBytes(ADMIN_WALLET));
    const automation = Keypair.fromSecretKey(readKeypairBytes(AUTOMATION_WALLET));

    await airdrop(connection, admin.publicKey, 20);
    await airdrop(connection, automation.publicKey, 5);

    console.log(`[fast-demo] Deploying Meridian locally: ${programId.toBase58()}`);
    await run("anchor", ["deploy", "--provider.cluster", "localnet"]);

    console.log("[fast-demo] Creating demo USDC mint and funding admin ATA");
    const usdcMint = await createMint(connection, admin, admin.publicKey, null, 6);
    const adminUsdc = await createAssociatedTokenAccount(connection, admin, usdcMint, admin.publicKey);
    await mintTo(connection, admin, usdcMint, adminUsdc, admin, 10_000_000n);

    await run("npm", ["run", "lifecycle:demo"], {
      SOLANA_CLUSTER: "localnet",
      SOLANA_RPC_URL: RPC_URL,
      MERIDIAN_PROGRAM_ID: programId.toBase58(),
      USDC_MINT: usdcMint.toBase58(),
      ANCHOR_WALLET: ADMIN_WALLET,
      AUTOMATION_WALLET,
      ADMIN_OVERRIDE_DELAY_SECS: "1",
      LIFECYCLE_ADMIN_OVERRIDE_DELAY_SECS: "1",
      LIFECYCLE_MAX_WAIT_SECS: "120",
      LIFECYCLE_DEMO_EXPIRY_SECS: "5",
      LIFECYCLE_DEMO_SETTLEMENT_CENTS: "69000",
    });

    console.log("[fast-demo] Complete.");
  } finally {
    validator.kill();
  }
}

async function waitForRpc(): Promise<void> {
  const connection = new Connection(RPC_URL, "confirmed");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await connection.getLatestBlockhash();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error("local validator did not become ready within 30s");
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol: number): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function run(command: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

function keypairPubkey(path: string): PublicKey {
  return Keypair.fromSecretKey(readKeypairBytes(path)).publicKey;
}

function requireFile(path: string): void {
  if (!existsSync(path)) throw new Error(`missing required file: ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

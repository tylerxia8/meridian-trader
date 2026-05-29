import "dotenv/config";
import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

async function main(): Promise<void> {
  const rpcUrl = requiredEnv("SOLANA_RPC_URL");
  const admin = Keypair.fromSecretKey(readKeypairBytes(requiredEnv("ANCHOR_WALLET")));
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync("target/idl/meridian.json", "utf8"));
  const program = new Program(idl, provider) as Program;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];

  const maxStalenessSecs = envNumber("ORACLE_MAX_STALENESS_SECS", 300);
  const confRatio = Number(process.env.ORACLE_MAX_CONF_RATIO ?? "0.005");
  const maxConfRatioBps = Number.isFinite(confRatio) && confRatio < 1 ? Math.round(confRatio * 10_000) : confRatio;
  const adminOverrideDelaySecs = envNumber("ADMIN_OVERRIDE_DELAY_SECS", 3600);

  console.log(`[config:update] Config: ${config.toBase58()}`);
  console.log(`[config:update] max_staleness_secs=${maxStalenessSecs}`);
  console.log(`[config:update] max_conf_ratio_bps=${maxConfRatioBps}`);
  console.log(`[config:update] admin_override_delay_secs=${adminOverrideDelaySecs}`);

  await program.methods
    .updateConfig(maxStalenessSecs, maxConfRatioBps, adminOverrideDelaySecs)
    .accounts({
      admin: admin.publicKey,
      config,
    })
    .signers([admin])
    .rpc();

  const updated = await (program.account as any).config.fetch(config);
  console.log(
    `[config:update] Updated: max_staleness_secs=${updated.maxStalenessSecs}, max_conf_ratio_bps=${updated.maxConfRatioBps}, admin_override_delay_secs=${updated.adminOverrideDelaySecs}`
  );
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
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid non-negative numeric env var ${key}: ${value}`);
  return parsed;
}

function readKeypairBytes(path: string): Uint8Array {
  return Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

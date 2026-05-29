import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Config, readKeypairBytes } from "./config.js";

export interface ProgramContext {
  connection: Connection;
  provider: AnchorProvider;
  wallet: Wallet;
  program: Program;
}

export function loadProgram(cfg: Config): ProgramContext {
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const keypair = Keypair.fromSecretKey(readKeypairBytes(cfg.automationKeypairPath));
  const wallet = new anchor.Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(findIdlPath(), "utf8"));
  const program = new Program(idl, provider);

  return { connection, provider, wallet, program };
}

function findIdlPath(): string {
  const candidates = [
    resolve(process.cwd(), "target", "idl", "meridian.json"),
    resolve(process.cwd(), "..", "target", "idl", "meridian.json"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Missing target/idl/meridian.json; run anchor build");
  return found;
}

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { configPda, MarketKeys, vaultPda } from "@/lib/meridian";
import { envValue } from "./env";

export type Outcome = "unsettled" | "yesWins" | "noWins";

export type MeridianServerContext = {
  connection: Connection;
  provider: AnchorProvider;
  program: Program;
  programId: string;
  config: any;
};

export async function createMeridianServerContext(): Promise<MeridianServerContext> {
  const rpcUrl = envValue("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
  const programId = envValue("NEXT_PUBLIC_MERIDIAN_PROGRAM_ID", "MERIDIAN_PROGRAM_ID");
  if (!programId) throw new Error("Missing Meridian program id");

  const connection = new Connection(rpcUrl, "confirmed");
  const dummy = Keypair.generate();
  const wallet = {
    publicKey: dummy.publicKey,
    signTransaction: async <T extends Transaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction>(txs: T[]) => txs,
  };
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(findIdlPath(), "utf8"));
  idl.address = programId;
  const program = new Program(idl, provider);
  const config = await (program.account as any).config.fetch(configPda(program.programId));

  return { connection, provider, program, programId, config };
}

export function marketKeysFor(programId: PublicKey, marketAddress: PublicKey, marketAccount: any): MarketKeys {
  return {
    market: marketAddress,
    yesMint: marketAccount.yesMint as PublicKey,
    noMint: marketAccount.noMint as PublicKey,
    vault: vaultPda(programId, marketAddress),
  };
}

export function outcomeName(outcome: any): Outcome {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

export function linkedPhoenixMarketError(marketAccount: any, phoenixMarket: PublicKey): string | null {
  const linkedPhoenixMarket = marketAccount.phoenixMarket as PublicKey;
  if (!linkedPhoenixMarket || linkedPhoenixMarket.equals(PublicKey.default)) {
    return "Market is not linked to a Phoenix book";
  }
  if (!linkedPhoenixMarket.equals(phoenixMarket)) {
    return "Phoenix market does not match the selected Meridian market";
  }
  return null;
}

export function activeMarketError(marketAccount: any, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (outcomeName(marketAccount.outcome) !== "unsettled") return "Market is already settled";
  if (Number(marketAccount.expiryTs) <= nowSec) {
    return "Market is expired and waiting for settlement";
  }
  return null;
}

function findIdlPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", "target", "idl", "meridian.json"),
    path.resolve(process.cwd(), "target", "idl", "meridian.json"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Missing target/idl/meridian.json; run anchor build");
  return found;
}

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { envValue } from "@/lib/server/env";
import { ensurePhoenixSeat } from "@/lib/server/phoenix-seat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      marketAddress?: string;
      phoenixMarket?: string;
      user?: string;
    };
    if (!body.marketAddress || !body.phoenixMarket || !body.user) {
      return Response.json({ error: "Missing Phoenix seat request fields" }, { status: 400 });
    }

    const rpcUrl = envValue("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
    const programId = envValue("NEXT_PUBLIC_MERIDIAN_PROGRAM_ID", "MERIDIAN_PROGRAM_ID");
    if (!programId) return Response.json({ error: "Missing Meridian program id" }, { status: 500 });
    const connection = new Connection(rpcUrl, "confirmed");
    const marketAddress = new PublicKey(body.marketAddress);
    const phoenixMarket = new PublicKey(body.phoenixMarket);
    const validationError = await linkedPhoenixMarketError(connection, programId, marketAddress, phoenixMarket);
    if (validationError) return Response.json({ error: validationError }, { status: 400 });

    const result = await ensurePhoenixSeat({
      connection,
      phoenixMarket,
      trader: new PublicKey(body.user),
    });

    return Response.json(result);
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

async function linkedPhoenixMarketError(
  connection: Connection,
  programId: string,
  marketAddress: PublicKey,
  phoenixMarket: PublicKey
): Promise<string | null> {
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
  const marketAccount = await (program.account as any).market.fetch(marketAddress);
  const linkedPhoenixMarket = marketAccount.phoenixMarket as PublicKey;
  if (!linkedPhoenixMarket || linkedPhoenixMarket.equals(PublicKey.default)) {
    return "Market is not linked to a Phoenix book";
  }
  if (!linkedPhoenixMarket.equals(phoenixMarket)) {
    return "Phoenix market does not match the selected Meridian market";
  }
  if (outcomeName(marketAccount.outcome) !== "unsettled") {
    return "Market is already settled";
  }
  if (Number(marketAccount.expiryTs) <= Math.floor(Date.now() / 1000)) {
    return "Market is expired and waiting for settlement";
  }
  return null;
}

function outcomeName(outcome: any): "unsettled" | "yesWins" | "noWins" {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
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

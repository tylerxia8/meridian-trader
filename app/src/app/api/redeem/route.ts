import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MeridianClient, MarketKeys } from "@/lib/meridian";
import { envValue } from "@/lib/server/env";

type RedeemKind = "pair" | "yes" | "no";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      kind?: RedeemKind;
      marketAddress?: string;
      user?: string;
      amountAtoms?: string;
    };
    if (!body.kind || !body.marketAddress || !body.user || !body.amountAtoms) {
      return Response.json({ error: "Missing redeem request fields" }, { status: 400 });
    }

    const rpcUrl = envValue("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
    const programId = envValue("NEXT_PUBLIC_MERIDIAN_PROGRAM_ID", "MERIDIAN_PROGRAM_ID");
    if (!programId) return Response.json({ error: "Missing Meridian program id" }, { status: 500 });

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
    const configKey = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
    const config = await (program.account as any).config.fetch(configKey);
    const marketAddress = new PublicKey(body.marketAddress);
    const marketAccount = await (program.account as any).market.fetch(marketAddress);
    const marketKeys: MarketKeys = {
      market: marketAddress,
      yesMint: marketAccount.yesMint as PublicKey,
      noMint: marketAccount.noMint as PublicKey,
      vault: PublicKey.findProgramAddressSync([Buffer.from("vault"), marketAddress.toBuffer()], program.programId)[0],
    };
    const user = new PublicKey(body.user);
    const meridian = new MeridianClient({ provider, program, usdcMint: config.usdcMint as PublicKey });
    const amount = new BN(body.amountAtoms);
    if (amount.lten(0)) return Response.json({ error: "Amount must be greater than zero" }, { status: 400 });

    const redeemIx =
      body.kind === "pair"
        ? await meridian.redeemPairIx(marketKeys, user, amount)
        : body.kind === "yes"
          ? await meridian.redeemYesIx(marketKeys, user, amount)
          : await meridian.redeemNoIx(marketKeys, user, amount);

    const tx = new Transaction();
    tx.add(...meridian.ataIxs(marketKeys, user, user), redeemIx);
    tx.feePayer = user;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

    return Response.json({
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
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

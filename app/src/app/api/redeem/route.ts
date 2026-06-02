import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { MeridianClient } from "@/lib/meridian";
import { createMeridianServerContext, marketKeysFor, outcomeName } from "@/lib/server/meridian";

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
    if (!isRedeemKind(body.kind)) {
      return Response.json({ error: "Unsupported redeem kind" }, { status: 400 });
    }
    if (!/^[1-9]\d*$/.test(body.amountAtoms)) {
      return Response.json({ error: "Amount must be a positive integer atom value" }, { status: 400 });
    }

    const { connection, provider, program, config } = await createMeridianServerContext();
    const marketAddress = new PublicKey(body.marketAddress);
    const marketAccount = await (program.account as any).market.fetch(marketAddress);
    const outcome = outcomeName(marketAccount.outcome);
    if (body.kind === "yes" && outcome !== "yesWins") {
      return Response.json({ error: "YES tokens are only redeemable after YES wins" }, { status: 400 });
    }
    if (body.kind === "no" && outcome !== "noWins") {
      return Response.json({ error: "NO tokens are only redeemable after NO wins" }, { status: 400 });
    }
    const marketKeys = marketKeysFor(program.programId, marketAddress, marketAccount);
    const user = new PublicKey(body.user);
    const meridian = new MeridianClient({ provider, program, usdcMint: config.usdcMint as PublicKey });
    const amount = new BN(body.amountAtoms);

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

function isRedeemKind(value: string): value is RedeemKind {
  return value === "pair" || value === "yes" || value === "no";
}

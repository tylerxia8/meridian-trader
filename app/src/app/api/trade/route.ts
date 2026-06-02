import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { MeridianClient, MarketKeys } from "@/lib/meridian";
import { PhoenixWrapper } from "@/lib/phoenix";
import { envValue } from "@/lib/server/env";
import { ensurePhoenixSeat } from "@/lib/server/phoenix-seat";
import { buildBuyNoIxs, buildBuyYesIx, buildSellNoIxs, buildSellYesIx } from "@/lib/trade";

type TradeAction = "buyYes" | "sellYes" | "buyNo" | "sellNo";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: TradeAction;
      marketAddress?: string;
      phoenixMarket?: string;
      user?: string;
      sizeContracts?: string;
      yesPriceCents?: number;
    };

    if (!body.action || !body.marketAddress || !body.phoenixMarket || !body.user || !body.sizeContracts) {
      return Response.json({ error: "Missing trade request fields" }, { status: 400 });
    }
    if (!isTradeAction(body.action)) {
      return Response.json({ error: "Unsupported trade action" }, { status: 400 });
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
    const config = await (program.account as any).config.fetch(PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0]);
    const marketAddress = new PublicKey(body.marketAddress);
    const marketAccount = await (program.account as any).market.fetch(marketAddress);
    if (outcomeName(marketAccount.outcome) !== "unsettled") {
      return Response.json({ error: "Market is already settled" }, { status: 400 });
    }
    if (Number(marketAccount.expiryTs) <= Math.floor(Date.now() / 1000)) {
      return Response.json({ error: "Market is expired and waiting for settlement" }, { status: 400 });
    }
    const marketKeys: MarketKeys = {
      market: marketAddress,
      yesMint: marketAccount.yesMint as PublicKey,
      noMint: marketAccount.noMint as PublicKey,
      vault: PublicKey.findProgramAddressSync([Buffer.from("vault"), marketAddress.toBuffer()], program.programId)[0],
    };
    const user = new PublicKey(body.user);
    const phoenixMarket = new PublicKey(body.phoenixMarket);
    const linkedPhoenixMarket = marketAccount.phoenixMarket as PublicKey;
    if (!linkedPhoenixMarket || linkedPhoenixMarket.equals(PublicKey.default)) {
      return Response.json({ error: "Market is not linked to a Phoenix book" }, { status: 400 });
    }
    if (!linkedPhoenixMarket.equals(phoenixMarket)) {
      return Response.json({ error: "Phoenix market does not match the selected Meridian market" }, { status: 400 });
    }
    const meridian = new MeridianClient({
      provider,
      program,
      usdcMint: config.usdcMint as PublicKey,
    });
    const phoenix = await PhoenixWrapper.connect(connection, envValue("NEXT_PUBLIC_SOLANA_CLUSTER", "SOLANA_CLUSTER") ?? "devnet");
    const sizeAtoms = parseContractsToAtoms(body.sizeContracts);
    if (sizeAtoms <= 0n) return Response.json({ error: "Size must be greater than zero" }, { status: 400 });
    const topOfBook = await phoenix.getTopOfBook(phoenixMarket);
    const needsAsk = body.action === "buyYes" || body.action === "sellNo";
    const needsBid = body.action === "sellYes" || body.action === "buyNo";
    if (needsAsk && topOfBook.bestAskPriceInUsdc == null) {
      return Response.json({ error: "No Phoenix ask liquidity is available for this trade" }, { status: 409 });
    }
    if (needsBid && topOfBook.bestBidPriceInUsdc == null) {
      return Response.json({ error: "No Phoenix bid liquidity is available for this trade" }, { status: 409 });
    }
    await ensurePhoenixSeat({ connection, phoenixMarket, trader: user });

    const ctx = { meridian, phoenix, user, market: marketKeys, phoenixMarket };
    let tradeIxs;
    if (body.action === "buyYes") {
      tradeIxs = await buildBuyYesIx(ctx, sizeAtoms);
    } else if (body.action === "sellYes") {
      tradeIxs = await buildSellYesIx(ctx, sizeAtoms);
    } else if (body.action === "buyNo") {
      // Buy No mints a pair, then sells YES into the bid. The IOC limit
      // must be the live bid, not the UI midpoint/ask display price.
      tradeIxs = await buildBuyNoIxs(ctx, sizeAtoms, topOfBook.bestBidPriceInUsdc!);
    } else {
      tradeIxs = await buildSellNoIxs(ctx, sizeAtoms, { unwindWithRedeemPair: true });
    }

    const tx = new Transaction();
    tx.add(...meridian.ataIxs(marketKeys, user, user), ...tradeIxs);
    tx.feePayer = user;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

    return Response.json({
      transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}

function isTradeAction(value: string): value is TradeAction {
  return value === "buyYes" || value === "sellYes" || value === "buyNo" || value === "sellNo";
}

function outcomeName(outcome: any): "unsettled" | "yesWins" | "noWins" {
  if (!outcome || typeof outcome !== "object") return "unsettled";
  if ("yesWins" in outcome) return "yesWins";
  if ("noWins" in outcome) return "noWins";
  return "unsettled";
}

function parseContractsToAtoms(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(trimmed)) throw new Error("Size must be a positive number with up to 6 decimals");
  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
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

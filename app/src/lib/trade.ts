// The four trade paths, expressed as transaction builders.
//
// Architectural note (PRD § "The Order Book — One Book, Two Perspectives"):
// each strike has ONE Phoenix market trading Yes vs USDC. The four user
// actions map onto it as:
//
//   buy_yes  -> Phoenix Buy (or Bid limit)
//   sell_yes -> Phoenix Sell (or Ask limit)
//   buy_no   -> atomic [meridian.mint_pair, Phoenix Sell-Yes IOC]
//   sell_no  -> Phoenix Buy-Yes (user ends up with Yes + No = $1 redeemable
//               pair; UI/automation can optionally append redeem_pair to
//               net out to USDC in the same tx)
//
// All transactions are built as a single Solana transaction so they're atomic
// at the chain level — one wallet approval per user action.
import { BN } from "@coral-xyz/anchor";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { MarketKeys, MeridianClient } from "./meridian";
import { PhoenixWrapper } from "./phoenix";

export interface TradeContext {
  meridian: MeridianClient;
  phoenix: PhoenixWrapper;
  user: PublicKey;
  market: MarketKeys;
  phoenixMarket: PublicKey;
}

/// Buy Yes — direct Phoenix Buy. Goes to the ask side of the book.
export async function buildBuyYesIx(
  ctx: TradeContext,
  sizeInBaseAtoms: bigint
): Promise<TransactionInstruction[]> {
  return [
    await ctx.phoenix.placeMarketOrderIx({
      marketAddress: ctx.phoenixMarket,
      side: "Buy",
      sizeInBaseAtoms,
      trader: ctx.user,
    }),
  ];
}

/// Sell Yes — direct Phoenix Sell. Goes to the bid side of the book.
export async function buildSellYesIx(
  ctx: TradeContext,
  sizeInBaseAtoms: bigint
): Promise<TransactionInstruction[]> {
  return [
    await ctx.phoenix.placeMarketOrderIx({
      marketAddress: ctx.phoenixMarket,
      side: "Sell",
      sizeInBaseAtoms,
      trader: ctx.user,
    }),
  ];
}

/// Buy No — atomic mint-pair + Phoenix Sell-Yes IOC. The user deposits $1
/// per pair, immediately sells the Yes side at market, keeps the No side.
/// Effective cost of No = $1 - Yes sale price.
///
/// `priceLimitUsdc` is the worst Yes sell price the user accepts; the IOC
/// order fills against the bid side up to that price.
export async function buildBuyNoIxs(
  ctx: TradeContext,
  sizeInBaseAtoms: bigint,
  priceLimitUsdc: number
): Promise<TransactionInstruction[]> {
  const mintIx = await ctx.meridian.mintPairIx(ctx.market, ctx.user, new BN(sizeInBaseAtoms.toString()));
  const sellIx = await ctx.phoenix.placeLimitOrderIx({
    marketAddress: ctx.phoenixMarket,
    side: "Sell",
    priceInUsdc: priceLimitUsdc,
    sizeInBaseAtoms,
    trader: ctx.user,
    immediateOrCancel: true,
  });
  return [mintIx, sellIx];
}

/// Sell No — buy Yes from the book. After the buy, the user holds the No
/// they already had plus the new Yes; that pair is worth $1. If the caller
/// wants USDC out in the same tx, set `unwindWithRedeemPair=true` to append
/// a redeem_pair instruction.
export async function buildSellNoIxs(
  ctx: TradeContext,
  sizeInBaseAtoms: bigint,
  options: { unwindWithRedeemPair?: boolean } = {}
): Promise<TransactionInstruction[]> {
  const buyIx = await ctx.phoenix.placeMarketOrderIx({
    marketAddress: ctx.phoenixMarket,
    side: "Buy",
    sizeInBaseAtoms,
    trader: ctx.user,
  });
  if (!options.unwindWithRedeemPair) return [buyIx];

  const redeemIx = await ctx.meridian.redeemPairIx(
    ctx.market,
    ctx.user,
    new BN(sizeInBaseAtoms.toString())
  );
  return [buyIx, redeemIx];
}

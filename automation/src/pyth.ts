// Pyth integration: off-chain previous-close lookup (Hermes REST) and
// on-chain price-update posting (so settle_market can read a fresh
// PriceUpdateV2 account).
//
// Hermes API reference: https://docs.pyth.network/price-feeds/api-reference
import { Connection, PublicKey } from "@solana/web3.js";
import { PriceServiceConnection } from "@pythnetwork/price-service-client";
import {
  InstructionWithEphemeralSigners,
  PythSolanaReceiver,
} from "@pythnetwork/pyth-solana-receiver";
import { Ticker } from "./config.js";

export interface PythPrice {
  /// Integer in feed's own units. Multiply by 10^expo for USD.
  price: number;
  /// Symmetric confidence interval, same units as price.
  conf: number;
  /// Signed exponent, typically -8 for equity feeds.
  expo: number;
  /// Unix seconds.
  publishTime: number;
}

/// Fetch the latest published price for one or more feeds via Hermes REST.
/// For the morning job, "latest" at 8am ET *is* the previous trading day's
/// 4pm close (equity feeds don't publish overnight).
export async function fetchLatestPrices(
  hermesUrl: string,
  feedIds: Partial<Record<Ticker, string>>
): Promise<Partial<Record<Ticker, PythPrice>>> {
  const tickers = Object.keys(feedIds) as Ticker[];
  if (tickers.length === 0) return {};
  const params = new URLSearchParams();
  for (const t of tickers) params.append("ids[]", feedIds[t]!);
  const url = `${hermesUrl}/api/latest_price_feeds?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hermes fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as Array<{
    id: string;
    price: { price: string; conf: string; expo: number; publish_time: number };
  }>;
  const result: Partial<Record<Ticker, PythPrice>> = {};
  for (const t of tickers) {
    // Hermes returns ids without the 0x prefix; normalize.
    const want = feedIds[t]!.replace(/^0x/, "").toLowerCase();
    const match = body.find((p) => p.id.toLowerCase() === want);
    if (!match) continue;
    result[t] = {
      price: Number(match.price.price),
      conf: Number(match.price.conf),
      expo: match.price.expo,
      publishTime: match.price.publish_time,
    };
  }
  return result;
}

/// Convert a Pyth price to USD cents (integer). Same math the on-chain
/// settle_market does — duplicated here so the morning job can compute
/// strikes from the previous-close price without an RPC roundtrip.
export function pythPriceToUsdCents(p: PythPrice): number {
  const adj = p.expo + 2;
  return adj >= 0 ? p.price * 10 ** adj : Math.floor(p.price / 10 ** -adj);
}

/// Hex feed-id -> 32-byte array. The on-chain program stores feed ids as
/// [u8; 32]; settle_market verifies the PriceUpdateV2 matches.
export function hexToFeedIdBytes(hex: string): number[] {
  const clean = hex.replace(/^0x/, "");
  if (clean.length !== 64) throw new Error(`Invalid feed id length: ${hex}`);
  const out = new Array<number>(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/// Post a fresh PriceUpdateV2 account on-chain by submitting Hermes's signed
/// VAA bytes to the Pyth receiver program. Returns the PriceUpdateV2 pubkey
/// the settlement instruction should read.
///
/// Uses `@pythnetwork/price-service-client` to fetch the latest signed VAA
/// from Hermes, then `@pythnetwork/pyth-solana-receiver` to build the Solana
/// instructions that post the update account consumed by settle_market.
export async function postPriceUpdate(
  connection: Connection,
  wallet: any,
  hermesUrl: string,
  feedId: string
): Promise<{
  priceUpdateAccount: PublicKey;
  postIxs: InstructionWithEphemeralSigners[];
  closeIxs: InstructionWithEphemeralSigners[];
}> {
  const normalizedFeedId = feedId.replace(/^0x/, "").toLowerCase();
  const priceService = new PriceServiceConnection(hermesUrl, {
    priceFeedRequestConfig: { binary: true },
  });
  const vaas = await priceService.getLatestVaas([normalizedFeedId]);
  if (vaas.length === 0) {
    throw new Error(`Hermes returned no VAA for feed ${feedId}`);
  }

  const receiver = new PythSolanaReceiver({ connection, wallet });
  const { postInstructions, priceFeedIdToPriceUpdateAccount, closeInstructions } =
    await receiver.buildPostPriceUpdateInstructions(vaas);
  const priceUpdateAccount =
    priceFeedIdToPriceUpdateAccount[normalizedFeedId] ??
    priceFeedIdToPriceUpdateAccount[`0x${normalizedFeedId}`];
  if (!priceUpdateAccount) {
    const keys = Object.keys(priceFeedIdToPriceUpdateAccount);
    throw new Error(
      `Pyth receiver did not return a price update account for feed ${feedId}; returned keys: ${keys.join(", ")}`
    );
  }

  return {
    priceUpdateAccount,
    postIxs: postInstructions,
    closeIxs: closeInstructions,
  };
}

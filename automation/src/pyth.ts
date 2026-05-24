// Pyth integration: off-chain previous-close lookup (Hermes REST) and
// on-chain price-update posting (so settle_market can read a fresh
// PriceUpdateV2 account).
//
// Hermes API reference: https://docs.pyth.network/price-feeds/api-reference
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
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
/// Implementation note: this is a stub. The full flow uses
/// `@pythnetwork/pyth-solana-receiver` (PythSolanaReceiver class), which
/// fetches the VAA from Hermes, builds a verification ix, and a "post" ix.
/// We defer wiring this end-to-end to Phase 7's lifecycle script where the
/// pieces can be exercised against real devnet/local infra.
export async function postPriceUpdate(
  _connection: Connection,
  _feedId: string
): Promise<{ priceUpdateAccount: PublicKey; ixs: TransactionInstruction[] }> {
  throw new Error(
    "postPriceUpdate is not yet wired. Use @pythnetwork/pyth-solana-receiver " +
      "PythSolanaReceiver.buildPostPriceUpdateInstructions(vaa). Lifecycle " +
      "demo in Phase 7 will fill this in."
  );
}

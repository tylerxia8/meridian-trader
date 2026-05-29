import { fetchLiveMarkets } from "@/lib/live-markets";
import { summarizeMarkets, summarizeMarketsByTicker } from "@/lib/market-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const live = await fetchLiveMarkets();
  if (live.kind === "unavailable") {
    return Response.json({ ok: false, reason: live.reason }, { status: 503 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const pending = live.markets.filter((market) => market.outcome === "unsettled" && market.expiryTs <= nowSec);
  const active = live.markets.filter((market) => market.outcome === "unsettled" && market.expiryTs > nowSec);

  return Response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    stats: summarizeMarkets(live.markets, nowSec),
    byTicker: summarizeMarketsByTicker(live.markets, nowSec),
    activeMarkets: active.map((market) => ({
      address: market.address,
      ticker: market.ticker,
      strikeCents: market.strikeCents,
      expiryTs: market.expiryTs,
      configuredFeed: market.configuredFeed,
      phoenixMarket: market.phoenixMarket,
    })),
    pendingSettlement: pending.map((market) => ({
      address: market.address,
      ticker: market.ticker,
      strikeCents: market.strikeCents,
      expiryTs: market.expiryTs,
      configuredFeed: market.configuredFeed,
      priceFeedId: market.priceFeedId,
    })),
  });
}

import type { LiveMarket } from "./live-markets";

export type MarketStats = {
  total: number;
  active: number;
  expiredUnsettled: number;
  settled: number;
  yesWins: number;
  noWins: number;
  configuredFeed: number;
  fakeOrUnconfiguredFeed: number;
  phoenixLinked: number;
};

export function emptyMarketStats(): MarketStats {
  return {
    total: 0,
    active: 0,
    expiredUnsettled: 0,
    settled: 0,
    yesWins: 0,
    noWins: 0,
    configuredFeed: 0,
    fakeOrUnconfiguredFeed: 0,
    phoenixLinked: 0,
  };
}

export function summarizeMarkets(markets: LiveMarket[], nowSec = Math.floor(Date.now() / 1000)): MarketStats {
  const stats = emptyMarketStats();
  for (const market of markets) addMarket(stats, market, nowSec);
  return stats;
}

export function summarizeMarketsByTicker(
  markets: LiveMarket[],
  nowSec = Math.floor(Date.now() / 1000)
): Record<string, MarketStats> {
  return markets.reduce<Record<string, MarketStats>>((acc, market) => {
    acc[market.ticker] ??= emptyMarketStats();
    addMarket(acc[market.ticker], market, nowSec);
    return acc;
  }, {});
}

function addMarket(stats: MarketStats, market: LiveMarket, nowSec: number): void {
  stats.total += 1;
  if (market.configuredFeed) stats.configuredFeed += 1;
  else stats.fakeOrUnconfiguredFeed += 1;
  if (market.phoenixMarket) stats.phoenixLinked += 1;

  if (market.outcome === "unsettled") {
    if (market.expiryTs > nowSec) stats.active += 1;
    else stats.expiredUnsettled += 1;
    return;
  }

  stats.settled += 1;
  if (market.outcome === "yesWins") stats.yesWins += 1;
  else stats.noWins += 1;
}

export function outcomeLabel(outcome: LiveMarket["outcome"]): string {
  if (outcome === "yesWins") return "YES won";
  if (outcome === "noWins") return "NO won";
  return "Unsettled";
}

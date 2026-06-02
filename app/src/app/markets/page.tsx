import Link from "next/link";
import type { ReactNode } from "react";
import { fetchLiveMarkets } from "@/lib/live-markets";
import { summarizeMarketsByTicker } from "@/lib/market-stats";
import { MarketBrowser } from "@/components/MarketBrowser";

export const dynamic = "force-dynamic";

// Phase 6: tickers list is static. Phase 7 lifecycle / Phase 8 polish will
// wire in live last-close prices + active-contract counts from chain.
const TICKERS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" },
];

export default async function MarketsPage() {
  const live = await fetchLiveMarkets();
  const counts = live.kind === "live" ? summarizeMarketsByTicker(live.markets) : {};
  const nowSec = Math.floor(Date.now() / 1000);
  const activeMarkets =
    live.kind === "live"
      ? live.markets
          .filter((market) => market.outcome === "unsettled" && market.expiryTs > nowSec)
          .sort((a, b) => a.expiryTs - b.expiryTs || a.ticker.localeCompare(b.ticker) || a.strikeCents - b.strikeCents)
      : [];
  const activeConfigured = activeMarkets.filter((market) => market.configuredFeed).length;
  const activeDemo = activeMarkets.length - activeConfigured;
  const activeTradable = activeMarkets.filter(
    (market) => market.phoenixMarket && market.bestBidCents !== null && market.bestAskCents !== null
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Markets</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Seven underlyings. Real daily markets use configured Pyth feeds; demo markets are kept visible but labeled.
          </p>
        </div>
        {live.kind === "live" ? (
          <div className="flex gap-2 text-xs">
            <Badge tone={activeConfigured > 0 ? "ok" : "muted"}>{activeConfigured} real active</Badge>
            <Badge tone={activeTradable > 0 ? "info" : "muted"}>{activeTradable} tradable</Badge>
            <Badge tone={activeDemo > 0 ? "warn" : "muted"}>{activeDemo} demo active</Badge>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TICKERS.map((t) => (
          <Link
            key={t.symbol}
            href={`/trade/${t.symbol}`}
            className="rounded-lg border border-slate-800 bg-panel p-5 transition hover:border-slate-600"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xl font-semibold">{t.symbol}</span>
              <span className="text-xs text-slate-500">{t.name}</span>
            </div>
            <div className="mt-3 text-sm text-slate-400">
              {live.kind === "live" ? (
                <div className="space-y-2">
                  <div>
                    {counts[t.symbol]?.active ?? 0} active
                    <span className="text-slate-600"> / </span>
                    {counts[t.symbol]?.settled ?? 0} settled
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge tone={(counts[t.symbol]?.configuredFeed ?? 0) > 0 ? "ok" : "muted"}>
                      {counts[t.symbol]?.configuredFeed ?? 0} real
                    </Badge>
                    <Badge tone={(counts[t.symbol]?.fakeOrUnconfiguredFeed ?? 0) > 0 ? "warn" : "muted"}>
                      {counts[t.symbol]?.fakeOrUnconfiguredFeed ?? 0} demo
                    </Badge>
                    <Badge tone={(counts[t.symbol]?.phoenixLinked ?? 0) > 0 ? "info" : "muted"}>
                      {counts[t.symbol]?.phoenixLinked ?? 0} Phoenix
                    </Badge>
                  </div>
                </div>
              ) : (
                "View active strikes ->"
              )}
            </div>
          </Link>
        ))}
      </div>

      {live.kind === "live" ? (
        <MarketBrowser markets={live.markets} />
      ) : null}

      {live.kind === "unavailable" ? (
        <p className="text-xs text-slate-500">Live markets unavailable: {live.reason}. Showing ticker list.</p>
      ) : null}
    </div>
  );
}

function Badge({ children, tone }: { children: ReactNode; tone: "ok" | "warn" | "info" | "muted" }) {
  const classes = {
    ok: "border-yes/30 bg-yes/10 text-yes",
    warn: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    info: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    muted: "border-slate-700 bg-slate-800/40 text-slate-400",
  };
  return <span className={`rounded border px-2 py-0.5 ${classes[tone]}`}>{children}</span>;
}

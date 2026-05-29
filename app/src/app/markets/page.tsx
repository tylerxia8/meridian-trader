import Link from "next/link";
import { fetchLiveMarkets } from "@/lib/live-markets";

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
  const counts =
    live.kind === "live"
      ? live.markets.reduce<Record<string, number>>((acc, market) => {
          if (market.outcome === "unsettled") acc[market.ticker] = (acc[market.ticker] ?? 0) + 1;
          return acc;
        }, {})
      : {};

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Markets</h1>
      <p className="text-sm text-slate-400">
        Seven underlyings. Strikes are placed each morning at +/-3%, +/-6%, and +/-9% of the previous
        close, rounded to the nearest $10.
      </p>
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
              {live.kind === "live" ? `${counts[t.symbol] ?? 0} active strikes` : "View active strikes ->"}
            </div>
          </Link>
        ))}
      </div>
      {live.kind === "unavailable" ? (
        <p className="text-xs text-slate-500">Live markets unavailable: {live.reason}. Showing ticker list.</p>
      ) : null}
    </div>
  );
}

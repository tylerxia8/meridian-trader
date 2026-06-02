import Link from "next/link";
import type { ReactNode } from "react";
import { fetchLiveMarkets, LiveMarket } from "@/lib/live-markets";
import { outcomeLabel, summarizeMarkets, summarizeMarketsByTicker } from "@/lib/market-stats";
import { solanaExplorerAccountUrl } from "@/lib/explorer";
import { WalletReadiness } from "@/components/WalletReadiness";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const live = await fetchLiveMarkets();

  if (live.kind === "unavailable") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Status</h1>
          <p className="mt-1 text-sm text-slate-400">Live status unavailable: {live.reason}.</p>
        </div>
        <section className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4">
          <h2 className="text-sm font-medium text-amber-300">Recovery Cue</h2>
          <p className="mt-1 text-sm text-slate-300">
            Check RPC connectivity and generated Anchor artifacts, then rerun the status command from the project root.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <code className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">npm run demo:status</code>
            <code className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">anchor build</code>
          </div>
        </section>
        <WalletReadiness />
      </div>
    );
  }

  const stats = summarizeMarkets(live.markets);
  const byTicker = summarizeMarketsByTicker(live.markets);
  const pending = live.markets
    .filter((market) => market.outcome === "unsettled" && market.expiryTs <= Math.floor(Date.now() / 1000))
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.strikeCents - b.strikeCents);
  const pendingConfigured = pending.filter((market) => market.configuredFeed);
  const pendingDemo = pending.filter((market) => !market.configuredFeed);
  const active = live.markets.filter(
    (market) => market.outcome === "unsettled" && market.expiryTs > Math.floor(Date.now() / 1000)
  );
  const activeConfigured = active.filter((market) => market.configuredFeed);
  const activeTradable = active.filter(
    (market) => market.phoenixMarket && market.bestBidCents !== null && market.bestAskCents !== null
  );
  const recentlySettled = live.markets
    .filter((market) => market.outcome !== "unsettled")
    .sort((a, b) => b.settlementTs - a.settlementTs)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Status</h1>
          <p className="mt-1 text-sm text-slate-400">Devnet market lifecycle, settlement, and Phoenix linkage.</p>
        </div>
        <code className="rounded border border-slate-800 px-3 py-2 text-xs text-slate-400">npm run tradable:status</code>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Active" value={stats.active} />
        <Metric label="Tradable Now" value={activeTradable.length} />
        <Metric label="Settled" value={stats.settled} detail={`${stats.yesWins} YES / ${stats.noWins} NO`} />
        <Metric label="Expired Pending" value={stats.expiredUnsettled} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total Markets" value={stats.total} />
        <Metric label="Configured Feeds" value={stats.configuredFeed} />
        <Metric label="Fake/Unconfigured" value={stats.fakeOrUnconfiguredFeed} />
        <Metric label="Settlement Backlog" value={pendingConfigured.length} />
      </section>

      <ActionPanel
        activeConfigured={activeConfigured.length}
        activeDemo={active.length - activeConfigured.length}
        activeTradable={activeTradable.length}
        pendingConfigured={pendingConfigured.length}
        pendingDemo={pendingDemo.length}
      />

      <WalletReadiness />

      <section className="rounded-lg border border-slate-800 bg-panel p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-300">By Ticker</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Ticker</th>
                <th>Active</th>
                <th>Settled</th>
                <th>Pending</th>
                <th>Phoenix</th>
                <th>Fake Feed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {Object.entries(byTicker)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([ticker, tickerStats]) => (
                  <tr key={ticker}>
                    <td className="py-2">
                      <Link href={`/trade/${ticker}`} className="text-slate-200 hover:text-white">
                        {ticker}
                      </Link>
                    </td>
                    <td>{tickerStats.active}</td>
                    <td>{tickerStats.settled}</td>
                    <td>{tickerStats.expiredUnsettled}</td>
                    <td>{tickerStats.phoenixLinked}</td>
                    <td>{tickerStats.fakeOrUnconfiguredFeed}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <StatusList title="Configured Pending" empty="No configured-feed settlement backlog remains.">
          {pendingConfigured.map((market) => (
            <MarketStatusRow key={market.address} market={market} />
          ))}
        </StatusList>
        <StatusList title="Demo/Fake Pending" empty="No old demo markets are pending.">
          {pendingDemo.map((market) => (
            <MarketStatusRow key={market.address} market={market} />
          ))}
        </StatusList>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <StatusList title="Recent Settlements" empty="No settled markets yet.">
          {recentlySettled.map((market) => (
            <MarketStatusRow key={market.address} market={market} />
          ))}
        </StatusList>
      </section>
    </div>
  );
}

function ActionPanel({
  activeConfigured,
  activeDemo,
  activeTradable,
  pendingConfigured,
  pendingDemo,
}: {
  activeConfigured: number;
  activeDemo: number;
  activeTradable: number;
  pendingConfigured: number;
  pendingDemo: number;
}) {
  const message =
    pendingConfigured > 0
      ? "Configured-feed markets are expired and ready for settlement."
      : activeTradable > 0
        ? "At least one active Phoenix-linked market has bid/ask liquidity."
      : activeConfigured > 0
        ? "Real configured-feed markets are active."
        : activeDemo > 0
          ? "Only demo/fake-feed markets are active."
          : "No active markets are live.";
  const command =
    pendingConfigured > 0
      ? "SETTLEMENT_MAX_RETRIES=1 npm run settle:markets"
      : activeTradable > 0
        ? "npm run tradable:status"
      : activeConfigured > 0
        ? "npm run demo:status"
        : "npm run create:markets";

  return (
    <section className="rounded-lg border border-slate-800 bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Operator Cue</h2>
          <p className="mt-1 text-sm text-slate-500">
            {message}
            {pendingDemo > 0 ? ` ${pendingDemo} old demo market${pendingDemo === 1 ? "" : "s"} remain visible for auditability.` : ""}
          </p>
        </div>
        <code className="rounded border border-slate-800 px-3 py-2 text-xs text-slate-400">{command}</code>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-panel px-4 py-3">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function StatusList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return (
    <section className="rounded-lg border border-slate-800 bg-panel p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-300">{title}</h2>
      {isEmpty ? <p className="text-sm text-slate-500">{empty}</p> : <div className="space-y-2">{items}</div>}
    </section>
  );
}

function MarketStatusRow({ market }: { market: LiveMarket }) {
  return (
    <a
      href={solanaExplorerAccountUrl(market.address)}
      target="_blank"
      rel="noreferrer"
      className="block rounded border border-slate-800 px-3 py-2 text-sm hover:border-slate-700"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-200">
          {market.ticker} {">"} ${(market.strikeCents / 100).toFixed(0)}
        </span>
        <span className={market.outcome === "unsettled" ? "text-amber-300" : "text-yes"}>
          {outcomeLabel(market.outcome)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>{market.configuredFeed ? "configured feed" : "fake/unconfigured feed"}</span>
        {market.settlementPriceCents > 0 ? <span>settled @ ${(market.settlementPriceCents / 100).toFixed(2)}</span> : null}
        {market.phoenixMarket ? <span>Phoenix linked</span> : null}
      </div>
    </a>
  );
}

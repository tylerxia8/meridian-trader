"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { LiveMarket } from "@/lib/live-markets";
import { outcomeLabel } from "@/lib/market-stats";
import { solanaExplorerAccountUrl } from "@/lib/explorer";

type FilterKey = "active" | "tradable" | "real" | "demo" | "expired" | "settled" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "active", label: "Active" },
  { key: "tradable", label: "Tradable" },
  { key: "real", label: "Real feeds" },
  { key: "demo", label: "Demo" },
  { key: "expired", label: "Expired" },
  { key: "settled", label: "Settled" },
  { key: "all", label: "All" },
];

export function MarketBrowser({ markets }: { markets: LiveMarket[] }) {
  const [filter, setFilter] = useState<FilterKey>("active");
  const nowSec = Math.floor(Date.now() / 1000);
  const rows = useMemo(
    () => markets.filter((market) => matchesFilter(market, filter, nowSec)).sort((a, b) => sortRank(a, nowSec) - sortRank(b, nowSec) || a.ticker.localeCompare(b.ticker) || a.strikeCents - b.strikeCents),
    [filter, markets, nowSec]
  );

  return (
    <section className="rounded-lg border border-slate-800 bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300">Market Browser</h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`rounded border px-2 py-1 text-xs transition ${
                filter === item.key
                  ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                  : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyMessage(filter)}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Market</th>
                <th>State</th>
                <th>Feed</th>
                <th>Phoenix</th>
                <th>Liquidity</th>
                <th>Expiry</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((market) => (
                <tr key={market.address}>
                  <td className="py-2">
                    <Link href={`/trade/${market.ticker}`} className="text-slate-200 hover:text-white">
                      {market.ticker} {">"} ${(market.strikeCents / 100).toFixed(0)}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={stateTone(market, nowSec)}>{stateLabel(market, nowSec)}</Badge>
                  </td>
                  <td>
                    <Badge tone={market.configuredFeed ? "ok" : "warn"}>
                      {market.configuredFeed ? "configured" : "demo/fake"}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={market.phoenixMarket ? "info" : "muted"}>
                      {market.phoenixMarket ? "linked" : "none"}
                    </Badge>
                  </td>
                  <td className="text-xs text-slate-400">
                    {market.bestBidCents !== null || market.bestAskCents !== null
                      ? `Bid ${formatPrice(market.bestBidCents)} / Ask ${formatPrice(market.bestAskCents)}`
                      : "empty"}
                  </td>
                  <td>{formatTime(market.expiryTs)}</td>
                  <td>
                    <a
                      href={solanaExplorerAccountUrl(market.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs text-slate-500 hover:text-slate-300"
                    >
                      {shortAddress(market.address)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function matchesFilter(market: LiveMarket, filter: FilterKey, nowSec: number): boolean {
  const active = isActive(market, nowSec);
  const expired = market.outcome === "unsettled" && market.expiryTs <= nowSec;
  const tradable = active && Boolean(market.phoenixMarket && market.bestBidCents !== null && market.bestAskCents !== null);
  if (filter === "active") return active;
  if (filter === "tradable") return tradable;
  if (filter === "real") return market.configuredFeed;
  if (filter === "demo") return !market.configuredFeed;
  if (filter === "expired") return expired;
  if (filter === "settled") return market.outcome !== "unsettled";
  return true;
}

function sortRank(market: LiveMarket, nowSec: number): number {
  if (isActive(market, nowSec) && market.phoenixMarket && market.bestBidCents !== null && market.bestAskCents !== null) return 0;
  if (isActive(market, nowSec) && market.configuredFeed) return 1;
  if (isActive(market, nowSec)) return 2;
  if (market.outcome === "unsettled") return 3;
  return 4;
}

function isActive(market: LiveMarket, nowSec: number): boolean {
  return market.outcome === "unsettled" && market.expiryTs > nowSec;
}

function stateLabel(market: LiveMarket, nowSec: number): string {
  if (isActive(market, nowSec)) return "active";
  if (market.outcome === "unsettled") return "expired";
  return outcomeLabel(market.outcome);
}

function stateTone(market: LiveMarket, nowSec: number): "ok" | "warn" | "info" | "muted" {
  if (isActive(market, nowSec)) return "ok";
  if (market.outcome === "unsettled") return "warn";
  return "muted";
}

function emptyMessage(filter: FilterKey): string {
  if (filter === "tradable") return "No markets currently have a live Phoenix link and both bid/ask liquidity.";
  if (filter === "active") return "No active markets. Run the morning job or demo market script to create the next batch.";
  return "No markets match this filter.";
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

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts * 1000));
}

function formatPrice(cents: number | null): string {
  return cents === null ? "-" : `$${(cents / 100).toFixed(2)}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

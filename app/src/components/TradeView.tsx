"use client";
import { useMemo, useState } from "react";
import { SettlementCountdown } from "./SettlementCountdown";
import { OrderBookView } from "./OrderBookView";
import { TradePanel } from "./TradePanel";
import { allowedActions, UserBalances } from "@/lib/positions-client";
import type { LiveMarket } from "@/lib/live-markets";

type StrikeRow = {
  strikeCents: number;
  yesPriceCents: number;
  address?: string;
  expiryTs?: number;
  outcome?: LiveMarket["outcome"];
  phoenixMarket?: string | null;
};

function mockStrikesFor(ticker: string): StrikeRow[] {
  const base = ticker === "META" ? 68_000 : ticker === "AAPL" ? 23_000 : 30_000;
  return [
    { strikeCents: base - 3000, yesPriceCents: 78 },
    { strikeCents: base - 1500, yesPriceCents: 65 },
    { strikeCents: base, yesPriceCents: 50 },
    { strikeCents: base + 1500, yesPriceCents: 35 },
    { strikeCents: base + 3000, yesPriceCents: 22 },
  ];
}

export function TradeView({
  ticker,
  liveMarkets = [],
  liveReason = null,
}: {
  ticker: string;
  liveMarkets?: LiveMarket[];
  liveReason?: string | null;
}) {
  const strikes = useMemo(() => {
    const live = liveMarkets
      .filter((market) => market.ticker === ticker)
      .sort((a, b) => a.strikeCents - b.strikeCents)
      .map<StrikeRow>((market) => ({
        strikeCents: market.strikeCents,
        yesPriceCents: market.outcome === "yesWins" ? 100 : market.outcome === "noWins" ? 0 : 50,
        address: market.address,
        expiryTs: market.expiryTs,
        outcome: market.outcome,
        phoenixMarket: market.phoenixMarket,
      }));
    return live.length > 0 ? live : mockStrikesFor(ticker);
  }, [liveMarkets, ticker]);
  const [selected, setSelected] = useState(strikes[Math.floor(strikes.length / 2)]);
  const balances: UserBalances = { yes: 0n, no: 0n };
  const { allowed, guidance } = allowedActions(balances);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{ticker}</h1>
        <SettlementCountdown />
      </div>
      {liveReason ? <p className="text-xs text-slate-500">Live markets unavailable: {liveReason}.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr_1fr]">
        <aside className="rounded-lg border border-slate-800 bg-panel p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Strikes</div>
          <ul className="space-y-1">
            {strikes.map((s) => (
              <li key={`${s.address ?? "mock"}-${s.strikeCents}`}>
                <button
                  onClick={() => setSelected(s)}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${
                    selected.strikeCents === s.strikeCents && selected.address === s.address
                      ? "bg-slate-700/60"
                      : "hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex justify-between">
                    <span>{`> $${(s.strikeCents / 100).toFixed(0)}`}</span>
                    <span className="text-slate-400">
                      {`${s.yesPriceCents}c`} / {`${100 - s.yesPriceCents}c`}
                    </span>
                  </div>
                  {s.outcome ? (
                    <div className="mt-1 flex justify-between text-xs text-slate-500">
                      <span>{s.outcome}</span>
                      <span>{s.phoenixMarket ? "Phoenix linked" : "No Phoenix"}</span>
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-lg border border-slate-800 bg-panel p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-medium">
              {ticker} {`>`} ${(selected.strikeCents / 100).toFixed(0)}
            </h2>
            <span className="text-xs text-slate-500">Yes / No on one book</span>
          </div>
          {selected.address ? (
            <div className="mb-3 truncate text-xs text-slate-500">Market {selected.address}</div>
          ) : null}
          <OrderBookView yesPriceCents={selected.yesPriceCents} />
        </section>

        <aside className="rounded-lg border border-slate-800 bg-panel p-4">
          <TradePanel
            ticker={ticker}
            strikeCents={selected.strikeCents}
            yesPriceCents={selected.yesPriceCents}
            allowed={allowed}
            guidance={guidance}
          />
        </aside>
      </div>
    </div>
  );
}

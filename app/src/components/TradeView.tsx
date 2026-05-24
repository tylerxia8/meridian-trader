"use client";
import { useMemo, useState } from "react";
import { SettlementCountdown } from "./SettlementCountdown";
import { OrderBookView } from "./OrderBookView";
import { TradePanel } from "./TradePanel";
import { allowedActions, UserBalances } from "@/lib/positions-client";

// Phase 6 frontend skeleton: strikes are presented from a static list so the
// UI is navigable without a deployed program. Phase 7 lifecycle script
// replaces this with `MeridianClient.program.account.market.all()` filtered
// by ticker.
function mockStrikesFor(ticker: string): Array<{ strikeCents: number; yesPriceCents: number }> {
  // Just enough variety to exercise the OrderBook and TradePanel components.
  const base = ticker === "META" ? 68_000 : ticker === "AAPL" ? 23_000 : 30_000;
  return [
    { strikeCents: base - 3000, yesPriceCents: 78 },
    { strikeCents: base - 1500, yesPriceCents: 65 },
    { strikeCents: base, yesPriceCents: 50 },
    { strikeCents: base + 1500, yesPriceCents: 35 },
    { strikeCents: base + 3000, yesPriceCents: 22 },
  ];
}

export function TradeView({ ticker }: { ticker: string }) {
  const strikes = useMemo(() => mockStrikesFor(ticker), [ticker]);
  const [selected, setSelected] = useState(strikes[Math.floor(strikes.length / 2)]);
  // Mock balances until Phase 7 wires real chain reads.
  const balances: UserBalances = { yes: 0n, no: 0n };
  const { allowed, guidance } = allowedActions(balances);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{ticker}</h1>
        <SettlementCountdown />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr_1fr]">
        <aside className="rounded-lg border border-slate-800 bg-panel p-3">
          <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Strikes</div>
          <ul className="space-y-1">
            {strikes.map((s) => (
              <li key={s.strikeCents}>
                <button
                  onClick={() => setSelected(s)}
                  className={`w-full rounded px-3 py-2 text-left text-sm ${
                    selected.strikeCents === s.strikeCents
                      ? "bg-slate-700/60"
                      : "hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex justify-between">
                    <span>{`> $${(s.strikeCents / 100).toFixed(0)}`}</span>
                    <span className="text-slate-400">
                      {`${s.yesPriceCents}¢`} / {`${100 - s.yesPriceCents}¢`}
                    </span>
                  </div>
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

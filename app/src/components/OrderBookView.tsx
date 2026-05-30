"use client";

interface Level {
  priceCents: number;
  sizeBaseAtoms: bigint;
}

export function OrderBookView({
  yesPriceCents,
  bestBidCents,
  bestAskCents,
  bestBidSize,
  bestAskSize,
}: {
  yesPriceCents: number;
  bestBidCents: number | null;
  bestAskCents: number | null;
  bestBidSize: number | null;
  bestAskSize: number | null;
}) {
  const yesBids = liveLevel(bestBidCents, bestBidSize);
  const yesAsks = liveLevel(bestAskCents, bestAskSize);

  return (
    <div className="space-y-3">
      {bestBidCents == null && bestAskCents == null ? (
        <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
          No live Phoenix liquidity is available for this strike yet.
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <Side label="Yes" yesBids={yesBids} yesAsks={yesAsks} flip={false} referencePriceCents={yesPriceCents} />
        <Side label="No" yesBids={yesBids} yesAsks={yesAsks} flip referencePriceCents={100 - yesPriceCents} />
      </div>
    </div>
  );
}

function liveLevel(priceCents: number | null, size: number | null): Level[] {
  if (priceCents == null) return [];
  return [{
    priceCents,
    sizeBaseAtoms: BigInt(Math.max(0, Math.round((size ?? 0) * 1_000_000))),
  }];
}

function Side({
  label,
  yesBids,
  yesAsks,
  flip,
  referencePriceCents,
}: {
  label: string;
  yesBids: Level[];
  yesAsks: Level[];
  flip: boolean;
  referencePriceCents: number;
}) {
  const bids = flip ? yesAsks : yesBids;
  const asks = flip ? yesBids : yesAsks;
  const px = (c: number) => `${flip ? 100 - c : c}c`;
  const sz = (n: bigint) => (Number(n) / 1_000_000).toFixed(2);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-slate-500">
        <span>{label} book</span>
        <span className="normal-case tracking-normal">ref {referencePriceCents}c</span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="text-left font-normal">Bid</th>
            <th className="text-right font-normal">Size</th>
            <th className="w-2"></th>
            <th className="text-left font-normal">Size</th>
            <th className="text-right font-normal">Ask</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 3 }).map((_, i) => (
            <tr key={i}>
              <td className={bids[i] ? "text-yes" : "text-slate-700"}>{bids[i] ? px(bids[i].priceCents) : "empty"}</td>
              <td className="text-right text-slate-400">{bids[i] ? sz(bids[i].sizeBaseAtoms) : ""}</td>
              <td></td>
              <td className="text-slate-400">{asks[i] ? sz(asks[i].sizeBaseAtoms) : ""}</td>
              <td className={asks[i] ? "text-right text-no" : "text-right text-slate-700"}>
                {asks[i] ? px(asks[i].priceCents) : "empty"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";
// One book, two perspectives (PRD section). The same Yes-vs-USDC bids/asks
// are displayed on both sides:
//   - "Yes" view: bids = Buy-Yes, asks = Sell-Yes
//   - "No" view: bids = Sell-Yes (= Buy-No), asks = Buy-Yes (= Sell-No)
// Inverted by `1 - yesPrice` for the price column.
//
// Mock data only in this scaffold — Phase 7 wires PhoenixWrapper.getTopOfBook
// against the live Phoenix market.

interface Level {
  priceCents: number;
  sizeBaseAtoms: bigint;
}

function mockLadder(midCents: number, side: "bid" | "ask"): Level[] {
  return Array.from({ length: 5 }, (_, i) => ({
    priceCents: side === "bid" ? midCents - i : midCents + i + 1,
    sizeBaseAtoms: BigInt(2000000 * (5 - i)),
  }));
}

export function OrderBookView({ yesPriceCents }: { yesPriceCents: number }) {
  const yesBids = mockLadder(yesPriceCents - 1, "bid");
  const yesAsks = mockLadder(yesPriceCents, "ask");

  return (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <Side label="Yes" yesBids={yesBids} yesAsks={yesAsks} flip={false} />
      <Side label="No" yesBids={yesBids} yesAsks={yesAsks} flip={true} />
    </div>
  );
}

function Side({
  label,
  yesBids,
  yesAsks,
  flip,
}: {
  label: string;
  yesBids: Level[];
  yesAsks: Level[];
  flip: boolean;
}) {
  // For the No perspective, bids ↔ asks AND prices are mirrored to (100 - p) cents.
  const bids = flip ? yesAsks : yesBids;
  const asks = flip ? yesBids : yesAsks;
  const px = (c: number) => `${flip ? 100 - c : c}¢`;
  const sz = (n: bigint) => (Number(n) / 1_000_000).toFixed(2);

  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">{label} book</div>
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
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              <td className="text-yes">{bids[i] ? px(bids[i].priceCents) : ""}</td>
              <td className="text-right text-slate-400">
                {bids[i] ? sz(bids[i].sizeBaseAtoms) : ""}
              </td>
              <td></td>
              <td className="text-slate-400">{asks[i] ? sz(asks[i].sizeBaseAtoms) : ""}</td>
              <td className="text-right text-no">{asks[i] ? px(asks[i].priceCents) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

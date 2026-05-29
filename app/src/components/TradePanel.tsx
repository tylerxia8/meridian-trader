"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AllowedAction, UserBalances } from "@/lib/positions-client";

interface Props {
  ticker: string;
  strikeCents: number;
  yesPriceCents: number;
  marketAddress: string | null;
  phoenixMarket: string | null;
  outcome: "unsettled" | "yesWins" | "noWins" | null;
  balances: UserBalances;
  balanceStatus: string | null;
  allowed: AllowedAction[];
  guidance: string | null;
}

export function TradePanel({
  ticker,
  strikeCents,
  yesPriceCents,
  marketAddress,
  phoenixMarket,
  outcome,
  balances,
  balanceStatus,
  allowed,
  guidance,
}: Props) {
  const [size, setSize] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const { connected } = useWallet();
  const noPriceCents = 100 - yesPriceCents;
  const unavailableReason =
    !marketAddress
      ? "Select a live market before trading."
      : outcome && outcome !== "unsettled"
        ? "This market is already settled."
        : !phoenixMarket
          ? "This strike is not linked to a Phoenix book yet."
          : null;

  function handleClick(action: AllowedAction) {
    if (!connected) {
      setStatus("Connect a wallet before trading.");
      return;
    }
    if (unavailableReason) {
      setStatus(unavailableReason);
      return;
    }
    const contracts = Number(size);
    if (!Number.isFinite(contracts) || contracts <= 0) {
      setStatus("Enter a positive contract size.");
      return;
    }
    setStatus(`${labelFor(action)} is ready for Phoenix transaction submission wiring.`);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs text-slate-500">Size (contracts)</label>
        <input
          type="number"
          min={0}
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        />
      </div>

      <BalanceSummary balances={balances} balanceStatus={balanceStatus} />

      {guidance ? <div className="text-sm text-amber-400">{guidance}</div> : null}

      <PayoffRow label="If Yes wins" price={`${yesPriceCents}c`} payout="$1.00" win="yes" />
      <PayoffRow label="If No wins" price={`${noPriceCents}c`} payout="$1.00" win="no" />

      {unavailableReason ? (
        <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          {unavailableReason}
        </div>
      ) : null}

      <RoutePreview hasPhoenix={Boolean(phoenixMarket)} />

      <div className="grid grid-cols-2 gap-2 pt-2">
        <ActionButton
          label="Buy Yes"
          color="yes"
          enabled={connected && !unavailableReason && !guidance && allowed.includes("buyYes")}
          onClick={() => handleClick("buyYes")}
        />
        <ActionButton
          label="Sell Yes"
          color="yes"
          variant="outline"
          enabled={connected && !unavailableReason && !guidance && allowed.includes("sellYes")}
          onClick={() => handleClick("sellYes")}
        />
        <ActionButton
          label="Buy No"
          color="no"
          enabled={connected && !unavailableReason && !guidance && allowed.includes("buyNo")}
          onClick={() => handleClick("buyNo")}
        />
        <ActionButton
          label="Sell No"
          color="no"
          variant="outline"
          enabled={connected && !unavailableReason && !guidance && allowed.includes("sellNo")}
          onClick={() => handleClick("sellNo")}
        />
      </div>

      {status ? <p className="text-xs text-amber-300">{status}</p> : null}

      <p className="border-t border-slate-800 pt-3 text-xs text-slate-500">
        You pay ${(yesPriceCents / 100).toFixed(2)} per contract. You win $1.00 if {ticker} closes
        at or above ${(strikeCents / 100).toFixed(0)} at 4:00 PM ET.
      </p>
    </div>
  );
}

function RoutePreview({ hasPhoenix }: { hasPhoenix: boolean }) {
  const rows: Array<{ action: string; route: string }> = [
    { action: "Buy Yes", route: "Phoenix buy YES from asks" },
    { action: "Sell Yes", route: "Phoenix sell YES into bids" },
    { action: "Buy No", route: "Mint YES/NO pair, then sell YES on Phoenix" },
    { action: "Sell No", route: "Buy YES on Phoenix, then redeem matched YES/NO" },
  ];

  return (
    <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="uppercase tracking-wider text-slate-500">Transaction route</span>
        <span className={hasPhoenix ? "text-yes" : "text-slate-500"}>
          {hasPhoenix ? "Phoenix linked" : "Waiting for Phoenix link"}
        </span>
      </div>
      <div className="space-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.action} className="grid grid-cols-[4.5rem_1fr] gap-2">
            <span className="text-slate-400">{row.action}</span>
            <span className="text-slate-500">{row.route}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BalanceSummary({
  balances,
  balanceStatus,
}: {
  balances: UserBalances;
  balanceStatus: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded border border-slate-800 px-3 py-2">
        <div className="text-slate-500">YES balance</div>
        <div className="mt-1 text-sm text-slate-200">{formatContracts(balances.yes)}</div>
      </div>
      <div className="rounded border border-slate-800 px-3 py-2">
        <div className="text-slate-500">NO balance</div>
        <div className="mt-1 text-sm text-slate-200">{formatContracts(balances.no)}</div>
      </div>
      {balanceStatus ? <div className="col-span-2 text-slate-500">{balanceStatus}</div> : null}
    </div>
  );
}

function formatContracts(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function labelFor(action: AllowedAction): string {
  switch (action) {
    case "buyYes":
      return "Buy Yes";
    case "sellYes":
      return "Sell Yes";
    case "buyNo":
      return "Buy No";
    case "sellNo":
      return "Sell No";
  }
}

function PayoffRow({
  label,
  price,
  payout,
  win,
}: {
  label: string;
  price: string;
  payout: string;
  win: "yes" | "no";
}) {
  return (
    <div className="flex justify-between rounded border border-slate-800 px-3 py-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span>
        <span className="text-slate-500">{price} {"->"} </span>
        <span className={win === "yes" ? "text-yes" : "text-no"}>{payout}</span>
      </span>
    </div>
  );
}

function ActionButton({
  label,
  color,
  enabled,
  onClick,
  variant = "solid",
}: {
  label: string;
  color: "yes" | "no";
  enabled: boolean;
  onClick: () => void;
  variant?: "solid" | "outline";
}) {
  const base =
    "rounded px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const solid =
    color === "yes" ? "bg-yes text-ink hover:bg-yes/90" : "bg-no text-ink hover:bg-no/90";
  const outline =
    color === "yes"
      ? "border border-yes/60 text-yes hover:bg-yes/10"
      : "border border-no/60 text-no hover:bg-no/10";
  return (
    <button
      disabled={!enabled}
      onClick={onClick}
      className={`${base} ${variant === "solid" ? solid : outline}`}
    >
      {label}
    </button>
  );
}

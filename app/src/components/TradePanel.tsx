"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AllowedAction } from "@/lib/positions-client";

interface Props {
  ticker: string;
  strikeCents: number;
  yesPriceCents: number;
  allowed: AllowedAction[];
  guidance: string | null;
}

export function TradePanel({
  ticker,
  strikeCents,
  yesPriceCents,
  allowed,
  guidance,
}: Props) {
  const [size, setSize] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const { connected } = useWallet();
  const noPriceCents = 100 - yesPriceCents;

  if (guidance) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-amber-400">{guidance}</div>
      </div>
    );
  }

  function handleClick(action: AllowedAction) {
    if (!connected) {
      setStatus("Connect a wallet before trading.");
      return;
    }
    const contracts = Number(size);
    if (!Number.isFinite(contracts) || contracts <= 0) {
      setStatus("Enter a positive contract size.");
      return;
    }
    setStatus(
      `${labelFor(action)} is ready for transaction wiring once this strike is linked to a live Phoenix market.`
    );
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

      <PayoffRow label="If Yes wins" price={`${yesPriceCents}¢`} payout="$1.00" win="yes" />
      <PayoffRow label="If No wins" price={`${noPriceCents}¢`} payout="$1.00" win="no" />

      <div className="grid grid-cols-2 gap-2 pt-2">
        <ActionButton
          label="Buy Yes"
          color="yes"
          enabled={connected && allowed.includes("buyYes")}
          onClick={() => handleClick("buyYes")}
        />
        <ActionButton
          label="Sell Yes"
          color="yes"
          variant="outline"
          enabled={connected && allowed.includes("sellYes")}
          onClick={() => handleClick("sellYes")}
        />
        <ActionButton
          label="Buy No"
          color="no"
          enabled={connected && allowed.includes("buyNo")}
          onClick={() => handleClick("buyNo")}
        />
        <ActionButton
          label="Sell No"
          color="no"
          variant="outline"
          enabled={connected && allowed.includes("sellNo")}
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
        <span className="text-slate-500">{price} → </span>
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

"use client";
import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { AllowedAction, UserBalances } from "@/lib/positions-client";
import { outcomeLabel } from "@/lib/market-stats";
import { solanaExplorerAccountUrl } from "@/lib/explorer";
import { shortSignature, waitForSignatureConfirmation } from "@/lib/transaction-status";

interface Props {
  ticker: string;
  strikeCents: number;
  yesPriceCents: number;
  marketAddress: string | null;
  phoenixMarket: string | null;
  outcome: "unsettled" | "yesWins" | "noWins" | null;
  expiryTs?: number | null;
  bestBidCents?: number | null;
  bestAskCents?: number | null;
  balances: UserBalances;
  balanceStatus: string | null;
  allowed: AllowedAction[];
  guidance: string | null;
  onSubmitted?: () => void;
}

export function TradePanel({
  ticker,
  strikeCents,
  yesPriceCents,
  marketAddress,
  phoenixMarket,
  outcome,
  expiryTs,
  bestBidCents,
  bestAskCents,
  balances,
  balanceStatus,
  allowed,
  guidance,
  onSubmitted,
}: Props) {
  const [size, setSize] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<AllowedAction | null>(null);
  const [preparingSeat, setPreparingSeat] = useState(false);
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const noPriceCents = 100 - yesPriceCents;
  const expired = Boolean(expiryTs && expiryTs <= Math.floor(Date.now() / 1000));
  const hasBid = bestBidCents != null;
  const hasAsk = bestAskCents != null;
  const contracts = Number(size);
  const validContracts = Number.isFinite(contracts) && contracts > 0;
  const unavailableReason =
    !marketAddress
      ? "Select a live market before trading."
      : expired && outcome === "unsettled"
        ? "This market has expired and is waiting for settlement."
      : outcome && outcome !== "unsettled"
        ? "This market is already settled."
        : !phoenixMarket
          ? "This strike is not linked to a Phoenix book yet."
      : null;
  const liquidityMessage =
    phoenixMarket && !expired && outcome === "unsettled" && (!hasBid || !hasAsk)
      ? `Live liquidity missing: ${!hasBid && !hasAsk ? "bid and ask" : !hasBid ? "bid" : "ask"}.`
      : null;

  async function handleClick(action: AllowedAction) {
    if (!connected || !publicKey) {
      setStatus("Connect a wallet before trading.");
      return;
    }
    if (unavailableReason) {
      setStatus(unavailableReason);
      return;
    }
    if (!validContracts) {
      setStatus("Enter a positive contract size.");
      return;
    }
    if (submitting || preparingSeat) return;
    setSubmitting(action);
    setStatus(`Preparing ${labelFor(action)} transaction`);
    try {
      const response = await fetch("/api/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          marketAddress,
          phoenixMarket,
          user: publicKey.toBase58(),
          sizeContracts: size,
          yesPriceCents,
        }),
      });
      const payload = (await response.json()) as { transaction?: string; error?: string };
      if (!response.ok || !payload.transaction) throw new Error(payload.error ?? "Trade transaction build failed");
      const tx = Transaction.from(base64ToBytes(payload.transaction));
      const signature = await sendTransaction(tx, connection);
      setStatus(`${labelFor(action)} submitted: ${signature}. Confirming on devnet`);
      onSubmitted?.();
      const confirmation = await waitForSignatureConfirmation(connection, signature);
      setStatus(
        confirmation === "timeout"
          ? `${labelFor(action)} submitted: ${signature}. Still awaiting confirmation`
          : `${labelFor(action)} confirmed: ${signature}`
      );
      onSubmitted?.();
    } catch (err: any) {
      setStatus(err?.message ?? "Trade submission failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function prepareSeat() {
    if (!connected || !publicKey || !marketAddress || !phoenixMarket) {
      setStatus("Connect a wallet and select a Phoenix-linked market first.");
      return;
    }
    if (submitting || preparingSeat) return;
    setPreparingSeat(true);
    setStatus("Preparing Phoenix seat");
    try {
      const response = await fetch("/api/phoenix-seat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketAddress, phoenixMarket, user: publicKey.toBase58() }),
      });
      const payload = (await response.json()) as { signature?: string | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Phoenix seat setup failed");
      setStatus(payload.signature ? `Phoenix seat ready: ${payload.signature}` : "Phoenix seat already ready");
    } catch (err: any) {
      setStatus(err?.message ?? "Phoenix seat setup failed");
    } finally {
      setPreparingSeat(false);
    }
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

      <ExecutionPreview
        contracts={validContracts ? contracts : null}
        bestBidCents={bestBidCents ?? null}
        bestAskCents={bestAskCents ?? null}
        unavailable={Boolean(unavailableReason)}
      />

      {guidance ? <div className="text-sm text-amber-400">{guidance}</div> : null}

      <PayoffRow label="If Yes wins" price={`${yesPriceCents}c`} payout="$1.00" win="yes" />
      <PayoffRow label="If No wins" price={`${noPriceCents}c`} payout="$1.00" win="no" />

      {unavailableReason ? (
        <div className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          {outcome && outcome !== "unsettled" ? `${outcomeLabel(outcome)}. ${unavailableReason}` : unavailableReason}
        </div>
      ) : null}
      {liquidityMessage ? (
        <div className="rounded border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
          {liquidityMessage} Market orders are only enabled for sides with live Phoenix depth.
        </div>
      ) : null}

      <RoutePreview hasPhoenix={Boolean(phoenixMarket)} />

      {connected && phoenixMarket && !expired ? (
        <button
          type="button"
          onClick={prepareSeat}
          disabled={preparingSeat || Boolean(submitting)}
          className="w-full rounded border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-500"
        >
          {preparingSeat ? "Preparing Phoenix seat" : "Prepare Phoenix seat"}
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-2 pt-2">
        <ActionButton
          label="Buy Yes"
          color="yes"
          enabled={connected && hasAsk && !unavailableReason && !guidance && allowed.includes("buyYes") && !submitting && !preparingSeat}
          onClick={() => handleClick("buyYes")}
        />
        <ActionButton
          label="Sell Yes"
          color="yes"
          variant="outline"
          enabled={connected && hasBid && !unavailableReason && !guidance && allowed.includes("sellYes") && !submitting && !preparingSeat}
          onClick={() => handleClick("sellYes")}
        />
        <ActionButton
          label="Buy No"
          color="no"
          enabled={connected && hasBid && !unavailableReason && !guidance && allowed.includes("buyNo") && !submitting && !preparingSeat}
          onClick={() => handleClick("buyNo")}
        />
        <ActionButton
          label="Sell No"
          color="no"
          variant="outline"
          enabled={connected && hasAsk && !unavailableReason && !guidance && allowed.includes("sellNo") && !submitting && !preparingSeat}
          onClick={() => handleClick("sellNo")}
        />
      </div>

      {status ? <StatusLine status={status} /> : null}

      <p className="border-t border-slate-800 pt-3 text-xs text-slate-500">
        You pay ${(yesPriceCents / 100).toFixed(2)} per contract. You win $1.00 if {ticker} closes
        at or above ${(strikeCents / 100).toFixed(0)} at 4:00 PM ET.
      </p>
    </div>
  );
}

function StatusLine({ status }: { status: string }) {
  const signature = status.match(/[1-9A-HJ-NP-Za-km-z]{32,88}/)?.[0];
  const label = signature ? status.replace(signature, shortSignature(signature)) : status;
  return (
    <p className="text-xs text-amber-300">
      {label}
      {signature ? (
        <>
          {" "}
          <a
            href={solanaExplorerAccountUrl(signature, "tx")}
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 hover:text-white"
          >
            Explorer
          </a>
        </>
      ) : null}
    </p>
  );
}

function ExecutionPreview({
  contracts,
  bestBidCents,
  bestAskCents,
  unavailable,
}: {
  contracts: number | null;
  bestBidCents: number | null;
  bestAskCents: number | null;
  unavailable: boolean;
}) {
  const rows = [
    {
      label: "Buy Yes",
      value: bestAskCents == null ? "Needs ask liquidity" : `Pay ${formatUsd(bestAskCents, contracts)}`,
      enabled: bestAskCents != null && !unavailable && contracts != null,
    },
    {
      label: "Sell Yes",
      value: bestBidCents == null ? "Needs bid liquidity" : `Receive ${formatUsd(bestBidCents, contracts)}`,
      enabled: bestBidCents != null && !unavailable && contracts != null,
    },
    {
      label: "Buy No",
      value: bestBidCents == null ? "Needs bid liquidity" : `Pay ${formatUsd(100 - bestBidCents, contracts)}`,
      enabled: bestBidCents != null && !unavailable && contracts != null,
    },
    {
      label: "Sell No",
      value: bestAskCents == null ? "Needs ask liquidity" : `Receive ${formatUsd(100 - bestAskCents, contracts)}`,
      enabled: bestAskCents != null && !unavailable && contracts != null,
    },
  ];

  return (
    <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">Estimated execution</div>
      <div className="space-y-1 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className={row.enabled ? "text-slate-300" : "text-slate-600"}>{row.label}</span>
            <span className={row.enabled ? "text-slate-400" : "text-slate-600"}>{contracts == null ? "Enter size" : row.value}</span>
          </div>
        ))}
      </div>
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

function formatUsd(centsPerContract: number, contracts: number | null): string {
  if (contracts == null) return "-";
  return `$${((centsPerContract * contracts) / 100).toFixed(2)}`;
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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

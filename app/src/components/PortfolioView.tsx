"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { LiveMarket } from "@/lib/live-markets";
import { outcomeLabel } from "@/lib/market-stats";
import { solanaExplorerAccountUrl } from "@/lib/explorer";
import { shortSignature, waitForSignatureConfirmation } from "@/lib/transaction-status";

type PositionRow = {
  market: LiveMarket;
  yes: bigint;
  no: bigint;
};

type RedeemTarget = {
  row: PositionRow;
  redeem: { kind: "pair" | "yes" | "no"; amount: bigint };
};

export function PortfolioView({ markets }: { markets: LiveMarket[] }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkRedeeming, setBulkRedeeming] = useState(false);
  const visibleMarkets = useMemo(() => markets.filter((market) => market.configuredFeed), [markets]);
  const redeemableTargets = useMemo<RedeemTarget[]>(
    () =>
      rows.flatMap((row) => {
        const redeem = redeemable(row);
        return redeem ? [{ row, redeem }] : [];
      }),
    [rows]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!publicKey) {
        setRows([]);
        setStatus(null);
        return;
      }
      setStatus("Loading positions");
      try {
        const loaded = await Promise.all(
          visibleMarkets.map(async (market) => {
            const yesAta = getAssociatedTokenAddressSync(new PublicKey(market.yesMint), publicKey);
            const noAta = getAssociatedTokenAddressSync(new PublicKey(market.noMint), publicKey);
            const [yes, no] = await Promise.all([
              readTokenAmount(connection, yesAta),
              readTokenAmount(connection, noAta),
            ]);
            return { market, yes, no };
          })
        );
        if (!cancelled) {
          setRows(loaded.filter((row) => row.yes > 0n || row.no > 0n));
          setStatus(null);
        }
      } catch (err: any) {
        if (!cancelled) setStatus(err?.message ?? "Could not load positions");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey, refreshNonce, visibleMarkets]);

  if (!connected) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-sm text-slate-400">Connect a wallet to view positions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Portfolio</h1>
            {status ? <p className="mt-1 text-sm text-slate-500">{status}</p> : null}
          </div>
          {redeemableTargets.length > 1 ? (
            <button
              type="button"
              disabled={bulkRedeeming}
              onClick={() =>
                redeemAll({
                  targets: redeemableTargets,
                  publicKey,
                  sendTransaction,
                  connection,
                  setBulkStatus,
                  setBulkRedeeming,
                  refresh: () => setRefreshNonce((nonce) => nonce + 1),
                })
              }
              className="rounded border border-yes/60 px-3 py-2 text-xs text-yes transition hover:bg-yes/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkRedeeming ? "Redeeming all" : `Redeem all ${redeemableTargets.length}`}
            </button>
          ) : null}
        </div>
        {bulkStatus ? <p className="mt-2 text-xs text-amber-300">{bulkStatus}</p> : null}
      </div>

      {rows.length === 0 && !status ? (
        <div className="rounded-lg border border-slate-800 bg-panel p-6 text-sm text-slate-400">
          No token positions found for the connected wallet.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-panel">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Market</th>
                <th>Outcome</th>
                <th>YES</th>
                <th>NO</th>
                <th>Redeemable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={row.market.address}>
                  <td className="px-4 py-3">
                    <a href={`/trade/${row.market.ticker}`} className="text-slate-200 hover:text-white">
                      {row.market.ticker} {">"} ${(row.market.strikeCents / 100).toFixed(0)}
                    </a>
                  </td>
                  <td>{outcomeLabel(row.market.outcome)}</td>
                  <td>{formatContracts(row.yes)}</td>
                  <td>{formatContracts(row.no)}</td>
                  <td>
                    <RedeemCell
                      row={row}
                      publicKey={publicKey}
                      sendTransaction={sendTransaction}
                      connection={connection}
                      onSubmitted={() => {
                        setRefreshNonce((nonce) => nonce + 1);
                        window.setTimeout(() => setRefreshNonce((nonce) => nonce + 1), 2500);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function RedeemCell({
  row,
  publicKey,
  sendTransaction,
  connection,
  onSubmitted,
}: {
  row: PositionRow;
  publicKey: PublicKey | null;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  connection: Connection;
  onSubmitted: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const redeem = redeemable(row);
  if (!redeem) return <span>-</span>;
  return (
    <div className="flex flex-col gap-1">
      <button
        className="w-fit rounded border border-yes/60 px-2 py-1 text-xs text-yes hover:bg-yes/10"
        disabled={submitting}
        onClick={async () => {
          if (!publicKey || submitting) return;
          setSubmitting(true);
          setStatus("Preparing redeem");
          try {
            const response = await fetch("/api/redeem", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: redeem.kind,
                marketAddress: row.market.address,
                user: publicKey.toBase58(),
                amountAtoms: redeem.amount.toString(),
              }),
            });
            const payload = (await response.json()) as { transaction?: string; error?: string };
            if (!response.ok || !payload.transaction) throw new Error(payload.error ?? "Redeem transaction build failed");
            const signature = await sendTransaction(Transaction.from(base64ToBytes(payload.transaction)), connection);
            setStatus(`Submitted ${signature}. Confirming on devnet`);
            onSubmitted();
            const confirmation = await waitForSignatureConfirmation(connection, signature);
            setStatus(
              confirmation === "timeout"
                ? `Submitted ${signature}. Still awaiting confirmation`
                : `Confirmed ${signature}`
            );
            onSubmitted();
          } catch (err: any) {
            setStatus(err?.message ?? "Redeem failed");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Redeeming" : `Redeem ${formatContracts(redeem.amount)}`}
      </button>
      {status ? <RedeemStatus status={status} /> : null}
    </div>
  );
}

function RedeemStatus({ status }: { status: string }) {
  const signature = status.match(/[1-9A-HJ-NP-Za-km-z]{32,88}/)?.[0];
  const label = signature ? status.replace(signature, shortSignature(signature)) : status;
  return (
    <span className="text-xs text-slate-500">
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
    </span>
  );
}

function redeemable(row: PositionRow): { kind: "pair" | "yes" | "no"; amount: bigint } | null {
  if (row.market.outcome === "yesWins" && row.yes > 0n) return { kind: "yes", amount: row.yes };
  if (row.market.outcome === "noWins" && row.no > 0n) return { kind: "no", amount: row.no };
  const matched = row.yes < row.no ? row.yes : row.no;
  return matched > 0n ? { kind: "pair", amount: matched } : null;
}

async function redeemAll({
  targets,
  publicKey,
  sendTransaction,
  connection,
  setBulkStatus,
  setBulkRedeeming,
  refresh,
}: {
  targets: RedeemTarget[];
  publicKey: PublicKey | null;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  connection: Connection;
  setBulkStatus: (status: string | null) => void;
  setBulkRedeeming: (redeeming: boolean) => void;
  refresh: () => void;
}) {
  if (!publicKey || targets.length === 0) return;
  setBulkRedeeming(true);
  let completed = 0;
  try {
    for (const [index, target] of targets.entries()) {
      setBulkStatus(`Preparing redemption ${index + 1} of ${targets.length}`);
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: target.redeem.kind,
          marketAddress: target.row.market.address,
          user: publicKey.toBase58(),
          amountAtoms: target.redeem.amount.toString(),
        }),
      });
      const payload = (await response.json()) as { transaction?: string; error?: string };
      if (!response.ok || !payload.transaction) throw new Error(payload.error ?? "Redeem transaction build failed");
      const signature = await sendTransaction(Transaction.from(base64ToBytes(payload.transaction)), connection);
      setBulkStatus(`Submitted redemption ${index + 1} of ${targets.length}: ${shortSignature(signature)}`);
      refresh();
      const confirmation = await waitForSignatureConfirmation(connection, signature);
      completed += 1;
      setBulkStatus(
        confirmation === "timeout"
          ? `Submitted ${completed} of ${targets.length}; latest is still awaiting confirmation`
          : `Confirmed ${completed} of ${targets.length} redemptions`
      );
      refresh();
    }
    setBulkStatus(`Redeemed ${completed} position${completed === 1 ? "" : "s"}`);
  } catch (err: any) {
    setBulkStatus(`Redeemed ${completed} of ${targets.length}; stopped: ${err?.message ?? "redeem failed"}`);
  } finally {
    setBulkRedeeming(false);
    window.setTimeout(refresh, 2500);
  }
}

function formatContracts(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

async function readTokenAmount(connection: { getTokenAccountBalance: (address: PublicKey) => Promise<{ value: { amount: string } }> }, ata: PublicKey): Promise<bigint> {
  try {
    const balance = await connection.getTokenAccountBalance(ata);
    return BigInt(balance.value.amount);
  } catch (err: any) {
    if (err?.message?.includes("could not find account")) return 0n;
    throw err;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

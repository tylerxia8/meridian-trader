"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { LiveMarket } from "@/lib/live-markets";
import { outcomeLabel } from "@/lib/market-stats";

type PositionRow = {
  market: LiveMarket;
  yes: bigint;
  no: bigint;
};

export function PortfolioView({ markets }: { markets: LiveMarket[] }) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const visibleMarkets = useMemo(() => markets.filter((market) => market.configuredFeed), [markets]);

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
  }, [connection, publicKey, visibleMarkets]);

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
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        {status ? <p className="mt-1 text-sm text-slate-500">{status}</p> : null}
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
}: {
  row: PositionRow;
  publicKey: PublicKey | null;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  connection: Connection;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const redeem = redeemable(row);
  if (!redeem) return <span>-</span>;
  return (
    <div className="flex flex-col gap-1">
      <button
        className="w-fit rounded border border-yes/60 px-2 py-1 text-xs text-yes hover:bg-yes/10"
        onClick={async () => {
          if (!publicKey) return;
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
            setStatus(`Submitted ${signature.slice(0, 8)}...${signature.slice(-8)}`);
          } catch (err: any) {
            setStatus(err?.message ?? "Redeem failed");
          }
        }}
      >
        Redeem {formatContracts(redeem.amount)}
      </button>
      {status ? <span className="text-xs text-slate-500">{status}</span> : null}
    </div>
  );
}

function redeemable(row: PositionRow): { kind: "pair" | "yes" | "no"; amount: bigint } | null {
  if (row.market.outcome === "yesWins" && row.yes > 0n) return { kind: "yes", amount: row.yes };
  if (row.market.outcome === "noWins" && row.no > 0n) return { kind: "no", amount: row.no };
  const matched = row.yes < row.no ? row.yes : row.no;
  return matched > 0n ? { kind: "pair", amount: matched } : null;
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

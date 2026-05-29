"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import type { LiveMarket } from "@/lib/live-markets";
import { outcomeLabel } from "@/lib/market-stats";

type PositionRow = {
  market: LiveMarket;
  yes: bigint;
  no: bigint;
};

export function PortfolioView({ markets }: { markets: LiveMarket[] }) {
  const { publicKey, connected } = useWallet();
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
                  <td>{redeemableText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function redeemableText(row: PositionRow): string {
  if (row.market.outcome === "yesWins") return `${formatContracts(row.yes)} USDC`;
  if (row.market.outcome === "noWins") return `${formatContracts(row.no)} USDC`;
  const matched = row.yes < row.no ? row.yes : row.no;
  return matched > 0n ? `${formatContracts(matched)} matched pair` : "-";
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

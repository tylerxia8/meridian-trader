"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { solanaExplorerAccountUrl } from "@/lib/explorer";

type HistoryRow = {
  signature: string;
  slot: number;
  blockTime?: number | null;
  err: unknown;
};

export function HistoryView() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!publicKey) {
        setRows([]);
        setStatus(null);
        return;
      }
      setStatus("Loading signatures");
      try {
        const signatures = await connection.getSignaturesForAddress(publicKey, { limit: 25 });
        if (!cancelled) {
          setRows(signatures);
          setStatus(null);
        }
      } catch (err: any) {
        if (!cancelled) setStatus(err?.message ?? "Could not load signatures");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  if (!connected) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-slate-400">Connect a wallet to see recent wallet activity.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="mt-1 text-sm text-slate-400">
          Recent signatures for {publicKey?.toBase58().slice(0, 8)}...
        </p>
      </div>

      {status ? <p className="text-sm text-slate-500">{status}</p> : null}

      {rows.length === 0 && !status ? (
        <div className="rounded-lg border border-slate-800 bg-panel p-6 text-sm text-slate-400">
          No recent signatures found for this wallet.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-panel">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Signature</th>
                <th>Time</th>
                <th>Slot</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((row) => (
                <tr key={row.signature}>
                  <td className="px-4 py-3">
                    <a
                      href={solanaExplorerAccountUrl(row.signature, "tx")}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-200 hover:text-white"
                    >
                      {shortSig(row.signature)}
                    </a>
                  </td>
                  <td>{row.blockTime ? new Date(row.blockTime * 1000).toLocaleString() : "-"}</td>
                  <td>{row.slot}</td>
                  <td className={row.err ? "text-no" : "text-yes"}>{row.err ? "Failed" : "Confirmed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function shortSig(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

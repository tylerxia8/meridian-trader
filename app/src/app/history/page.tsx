"use client";
import { useWallet } from "@solana/wallet-adapter-react";

export default function HistoryPage() {
  const { connected, publicKey } = useWallet();
  if (!connected) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">History</h1>
        <p className="text-sm text-slate-400">Connect a wallet to see your trade history.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">History</h1>
      <p className="text-sm text-slate-400">
        Signatures involving {publicKey?.toBase58().slice(0, 8)}… will appear here. Phase 7 wires
        the RPC `getSignaturesForAddress` lookup.
      </p>
    </div>
  );
}

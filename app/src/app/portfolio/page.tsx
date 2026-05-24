"use client";
import { useWallet } from "@solana/wallet-adapter-react";

// Phase 6 scaffold: positions list is empty. Phase 7 wires Anchor's
// account.market.all() + token balance lookups for the connected wallet.
export default function PortfolioPage() {
  const { connected } = useWallet();

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
      <h1 className="text-2xl font-semibold">Portfolio</h1>
      <div className="rounded-lg border border-slate-800 bg-panel p-6 text-sm text-slate-400">
        No positions yet. Open <a href="/markets" className="text-yes">Markets</a> to start trading.
      </div>
    </div>
  );
}

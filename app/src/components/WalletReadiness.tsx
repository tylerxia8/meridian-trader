"use client";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";

type ApiStatus = {
  ok: boolean;
  reason?: string;
  usdcMint?: string | null;
  activeMarkets?: Array<{
    address: string;
    ticker: string;
    strikeCents: number;
    configuredFeed: boolean;
    phoenixMarket: string | null;
    bestBidCents: number | null;
    bestAskCents: number | null;
  }>;
};

type Readiness = {
  sol: number | null;
  usdcRaw: bigint | null;
  status: ApiStatus | null;
  error: string | null;
};

export function WalletReadiness() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [readiness, setReadiness] = useState<Readiness>({ sol: null, usdcRaw: null, status: null, error: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!publicKey) {
        setReadiness({ sol: null, usdcRaw: null, status: null, error: null });
        return;
      }
      try {
        const statusResponse = await fetch("/api/status", { cache: "no-store" });
        const status = (await statusResponse.json()) as ApiStatus;
        const solLamports = await connection.getBalance(publicKey, "confirmed");
        let usdcRaw: bigint | null = null;
        if (status.usdcMint) {
          const usdcAta = getAssociatedTokenAddressSync(new PublicKey(status.usdcMint), publicKey);
          usdcRaw = await tokenBalance(connection, usdcAta);
        }
        if (!cancelled) {
          setReadiness({ sol: solLamports / 1_000_000_000, usdcRaw, status, error: status.ok ? null : status.reason ?? null });
        }
      } catch (err: any) {
        if (!cancelled) setReadiness({ sol: null, usdcRaw: null, status: null, error: err?.message ?? "Readiness check failed" });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  const tradable = useMemo(
    () =>
      readiness.status?.activeMarkets?.filter(
        (market) => market.phoenixMarket && market.bestBidCents !== null && market.bestAskCents !== null
      ) ?? [],
    [readiness.status]
  );
  const nextStep = nextReadinessStep({
    connected,
    sol: readiness.sol,
    usdcRaw: readiness.usdcRaw,
    tradableCount: tradable.length,
    error: readiness.error,
  });

  return (
    <section className="rounded-lg border border-slate-800 bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-300">Wallet Readiness</h2>
          <p className="mt-1 text-sm text-slate-500">{nextStep}</p>
        </div>
        {tradable[0] ? (
          <a href={`/trade/${tradable[0].ticker}`} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500">
            Open {tradable[0].ticker}
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReadinessMetric label="Wallet" value={connected ? shortAddress(publicKey?.toBase58() ?? "") : "Not connected"} tone={connected ? "ok" : "warn"} />
        <ReadinessMetric label="SOL" value={readiness.sol == null ? "-" : readiness.sol.toFixed(3)} tone={(readiness.sol ?? 0) >= 0.02 ? "ok" : "warn"} />
        <ReadinessMetric label="Demo USDC" value={readiness.usdcRaw == null ? "-" : formatUsdc(readiness.usdcRaw)} tone={(readiness.usdcRaw ?? 0n) > 0n ? "ok" : "warn"} />
        <ReadinessMetric label="Tradable" value={tradable.length.toString()} tone={tradable.length > 0 ? "ok" : "warn"} />
      </div>
    </section>
  );
}

function ReadinessMetric({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" }) {
  return (
    <div className="rounded border border-slate-800 px-3 py-2">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={tone === "ok" ? "mt-1 text-sm text-yes" : "mt-1 text-sm text-amber-300"}>{value}</div>
    </div>
  );
}

function nextReadinessStep({
  connected,
  sol,
  usdcRaw,
  tradableCount,
  error,
}: {
  connected: boolean;
  sol: number | null;
  usdcRaw: bigint | null;
  tradableCount: number;
  error: string | null;
}): string {
  if (!connected) return "Connect a wallet to check demo readiness.";
  if (error) return `Status check unavailable: ${error}.`;
  if ((sol ?? 0) < 0.02) return "Wallet needs devnet SOL for transaction fees.";
  if ((usdcRaw ?? 0n) <= 0n) return "Wallet needs demo USDC before it can mint or trade contracts.";
  if (tradableCount === 0) return "No active Phoenix market has two-sided liquidity yet.";
  return "Ready for a browser trade on an active liquid market.";
}

async function tokenBalance(
  connection: { getTokenAccountBalance: (address: PublicKey, commitment?: "confirmed") => Promise<{ value: { amount: string } }> },
  ata: PublicKey
): Promise<bigint> {
  try {
    const balance = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch (err: any) {
    if (err?.message?.includes("could not find account")) return 0n;
    throw err;
  }
}

function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function shortAddress(address: string): string {
  if (!address) return "-";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

"use client";
import Link from "next/link";
import dynamic from "next/dynamic";

// WalletMultiButton ships with @solana/wallet-adapter-react-ui; load client-only.
const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export function NavBar() {
  return (
    <header className="border-b border-slate-800 bg-panel/60 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Meridian
        </Link>
        <div className="flex items-center gap-6 text-sm text-slate-300">
          <Link href="/markets" className="hover:text-white">
            Markets
          </Link>
          <Link href="/portfolio" className="hover:text-white">
            Portfolio
          </Link>
          <Link href="/status" className="hover:text-white">
            Status
          </Link>
          <Link href="/history" className="hover:text-white">
            History
          </Link>
          <WalletMultiButton />
        </div>
      </nav>
    </header>
  );
}

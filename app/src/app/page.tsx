import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">
          Will <span className="text-yes">META</span> close above $680 today?
        </h1>
        <p className="max-w-2xl text-slate-300">
          Meridian is a non-custodial dApp for trading binary outcome contracts on the daily closing
          prices of MAG7 US equities. Pay $X today. Win $1.00 if your side is right at 4:00 PM ET.
          Otherwise, the other side wins.
        </p>
        <div className="flex gap-4 pt-2">
          <Link
            href="/markets"
            className="rounded-md bg-yes px-4 py-2 text-sm font-medium text-ink hover:bg-yes/90"
          >
            Browse markets
          </Link>
          <a
            href="https://github.com/tylerxia8/meridian-trader"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm hover:border-slate-500"
          >
            Source on GitHub
          </a>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <Card title="$1.00 invariant">
          Yes payout + No payout = $1.00. Always. Enforced on-chain by the vault.
        </Card>
        <Card title="0DTE">
          Markets are created before US market open and settle the same day via Pyth at 4:00 PM ET.
        </Card>
        <Card title="One book, two perspectives">
          A single Phoenix order book per strike. The frontend abstracts Buy / Sell Yes / No into
          the right matching engine action.
        </Card>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-panel p-5">
      <h3 className="mb-2 font-medium">{title}</h3>
      <p className="text-sm text-slate-400">{children}</p>
    </div>
  );
}

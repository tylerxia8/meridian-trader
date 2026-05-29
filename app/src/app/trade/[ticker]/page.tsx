import { notFound } from "next/navigation";
import { TradeView } from "@/components/TradeView";
import { fetchLiveMarkets } from "@/lib/live-markets";

const VALID_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;

export const dynamic = "force-dynamic";

export default async function TradePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  if (!VALID_TICKERS.includes(ticker as (typeof VALID_TICKERS)[number])) {
    notFound();
  }
  const live = await fetchLiveMarkets();
  return (
    <TradeView
      ticker={ticker}
      liveMarkets={live.kind === "live" ? live.markets : []}
      liveReason={live.kind === "unavailable" ? live.reason : null}
    />
  );
}

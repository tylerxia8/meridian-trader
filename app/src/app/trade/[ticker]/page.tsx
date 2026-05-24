import { notFound } from "next/navigation";
import { TradeView } from "@/components/TradeView";

const VALID_TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;

export default function TradePage({ params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase();
  if (!VALID_TICKERS.includes(ticker as (typeof VALID_TICKERS)[number])) {
    notFound();
  }
  return <TradeView ticker={ticker} />;
}

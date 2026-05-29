import { PortfolioView } from "@/components/PortfolioView";
import { fetchLiveMarkets } from "@/lib/live-markets";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const live = await fetchLiveMarkets();
  return <PortfolioView markets={live.kind === "live" ? live.markets : []} />;
}

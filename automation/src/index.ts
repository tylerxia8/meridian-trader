// Phase 1 scaffold. Real implementation in Phase 5.
// Two cron jobs:
//   - Morning (8am ET, Mon-Fri): create_strike_market for each MAG7 ticker
//   - Settlement (4:05pm ET, Mon-Fri): settle_market for each open contract
import "dotenv/config";

const TICKERS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] as const;

async function main(): Promise<void> {
  console.log(`[meridian-automation] starting (cluster=${process.env.SOLANA_CLUSTER ?? "devnet"})`);
  console.log(`[meridian-automation] tracking tickers: ${TICKERS.join(", ")}`);
  console.log("[meridian-automation] Phase 5 will wire up the morning + settlement cron jobs.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Settlement job: walk every Market in Unsettled state whose expiry has
// passed, call settle_market with a fresh PriceUpdateV2 account. Retries on
// stale/wide-conf failures; alerts (via log error) if still failing after
// the configured retry window so a human can use admin_settle.
import * as anchor from "@coral-xyz/anchor";
import { Config } from "../config.js";
import { ProgramContext } from "../program.js";
import { logger } from "../logger.js";
import { isNyseTradingDay } from "../calendar.js";

export async function runSettlementJob(cfg: Config, ctx: ProgramContext): Promise<void> {
  const now = new Date();
  if (!isNyseTradingDay(now)) {
    logger.info({ date: now.toISOString() }, "skipping settlement job: not a trading day");
    return;
  }

  const nowSec = Math.floor(now.getTime() / 1000);
  const configKey = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    ctx.program.programId
  )[0];

  // Fetch every Market account. For larger deployments switch to a
  // memcmp filter on `outcome == Unsettled`.
  const markets = await ctx.program.account.market.all();
  const expired = markets.filter((m: any) => {
    const expiry: number = m.account.expiryTs.toNumber();
    const outcome = m.account.outcome;
    return expiry <= nowSec && outcome && "unsettled" in outcome;
  });

  if (expired.length === 0) {
    logger.info("settlement job: nothing to settle");
    return;
  }

  logger.info({ count: expired.length }, "settling expired markets");

  for (const entry of expired) {
    const market = entry.publicKey;
    const ticker: number[] = entry.account.ticker;
    const tickerStr = String.fromCharCode(...ticker.filter((b: number) => b !== 0));

    let settled = false;
    for (let attempt = 1; attempt <= cfg.settlementMaxRetries && !settled; attempt++) {
      try {
        // TODO (Phase 7): post a fresh Pyth price update on-chain via
        // PythSolanaReceiver.buildPostPriceUpdateInstructions and pass the
        // resulting PriceUpdateV2 pubkey to settleMarket below.
        const priceUpdate = await postFreshPriceUpdate(/* ticker, ctx */);

        await ctx.program.methods
          .settleMarket()
          .accounts({
            caller: ctx.wallet.publicKey,
            config: configKey,
            market,
            priceUpdate,
          })
          .rpc();
        logger.info({ market: market.toBase58(), ticker: tickerStr, attempt }, "settled");
        settled = true;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        // Transient oracle issues we retry on. Anything else is a hard error.
        const retryable = /OracleStale|OracleConfTooWide|connection|timeout/i.test(msg);
        if (!retryable || attempt === cfg.settlementMaxRetries) {
          logger.error(
            { market: market.toBase58(), ticker: tickerStr, attempt, err: msg },
            "settlement failed; admin_settle override may be needed after the delay window"
          );
          break;
        }
        logger.warn(
          { market: market.toBase58(), ticker: tickerStr, attempt, err: msg },
          "settle_market failed; retrying"
        );
        await sleep(cfg.settlementRetryDelayMs);
      }
    }
  }
  logger.info("settlement job complete");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Placeholder. Phase 7 lifecycle wires this through PythSolanaReceiver.
async function postFreshPriceUpdate(): Promise<anchor.web3.PublicKey> {
  throw new Error(
    "postFreshPriceUpdate not yet implemented. Phase 7 will wire Pyth's " +
      "PythSolanaReceiver to fetch a Hermes update and post it on-chain."
  );
}

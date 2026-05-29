// Settlement job: walk every Market in Unsettled state whose expiry has
// passed, call settle_market with a fresh PriceUpdateV2 account. Retries on
// stale/wide-conf failures. An explicit opt-in env flag can use delayed
// admin_settle if the oracle path remains unavailable after retries.
import * as anchor from "@coral-xyz/anchor";
import { Config, isTicker } from "../config.js";
import { ProgramContext } from "../program.js";
import { logger } from "../logger.js";
import { isNyseTradingDay } from "../calendar.js";
import { fetchLatestPrices, postPriceUpdate, pythPriceToUsdCents } from "../pyth.js";
import { TransactionBuilder } from "@pythnetwork/solana-utils";

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
  const configAccount = await (ctx.program.account as any).config.fetch(configKey);
  const adminOverrideDelaySecs = Number(configAccount.adminOverrideDelaySecs);

  // Fetch every Market account. For larger deployments switch to a
  // memcmp filter on `outcome == Unsettled`.
  const markets = await (ctx.program.account as any).market.all();
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
    const feedId = feedIdBytesToHex(entry.account.priceFeedId as number[]);
    if (!isConfiguredFeedId(cfg, feedId)) {
      logger.warn(
        { market: market.toBase58(), ticker: tickerStr, feedId },
        "skipping market with unconfigured Pyth feed id"
      );
      continue;
    }

    for (let attempt = 1; attempt <= cfg.settlementMaxRetries && !settled; attempt++) {
      try {
        if (!isTicker(tickerStr)) {
          throw new Error(`market ticker is not configured: ${tickerStr}`);
        }
        const { priceUpdateAccount, postIxs, closeIxs } = await postPriceUpdate(
          ctx.connection,
          ctx.wallet,
          cfg.hermesUrl,
          feedId
        );

        await sendPythInstructions(ctx, postIxs);

        await ctx.program.methods
          .settleMarket()
          .accounts({
            caller: ctx.wallet.publicKey,
            config: configKey,
            market,
            priceUpdate: priceUpdateAccount,
          })
          .rpc();

        // Rent cleanup is best-effort. If this fails, settlement has already
        // completed and the ephemeral accounts can be closed by a later sweep.
        sendPythInstructions(ctx, closeIxs).catch((closeErr) =>
          logger.warn(
            {
              market: market.toBase58(),
              ticker: tickerStr,
              err: closeErr?.message ?? String(closeErr),
            },
            "failed to close Pyth price update accounts"
          )
        );

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
          if (cfg.settlementAdminFallback) {
            settled = await tryAdminSettleFallback({
              cfg,
              ctx,
              configKey,
              market,
              tickerStr,
              expiry: entry.account.expiryTs.toNumber(),
              feedId,
              adminOverrideDelaySecs,
            });
          }
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

function feedIdBytesToHex(bytes: number[]): string {
  if (bytes.length !== 32) throw new Error(`invalid market price_feed_id length: ${bytes.length}`);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function isConfiguredFeedId(cfg: Config, feedId: string): boolean {
  const normalized = feedId.toLowerCase();
  return Object.values(cfg.feedIds).some((configured) => configured?.toLowerCase() === normalized);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendPythInstructions(
  ctx: ProgramContext,
  ixs: Array<{ instruction: anchor.web3.TransactionInstruction; signers: anchor.web3.Signer[] }>
): Promise<void> {
  if (ixs.length === 0) return;
  const builder = new TransactionBuilder(ctx.wallet.publicKey, ctx.connection);
  builder.addInstructions(ixs);
  const txs = builder.buildLegacyTransactions({ computeUnitPriceMicroLamports: 50_000 });
  for (const { tx, signers } of txs) {
    await ctx.provider.sendAndConfirm(tx, signers);
  }
}

async function tryAdminSettleFallback(args: {
  cfg: Config;
  ctx: ProgramContext;
  configKey: anchor.web3.PublicKey;
  market: anchor.web3.PublicKey;
  tickerStr: string;
  expiry: number;
  feedId: string;
  adminOverrideDelaySecs: number;
}): Promise<boolean> {
  const { cfg, ctx, configKey, market, tickerStr, expiry, feedId, adminOverrideDelaySecs } = args;
  const nowSec = Math.floor(Date.now() / 1000);
  const earliest = expiry + adminOverrideDelaySecs;
  if (nowSec < earliest) {
    logger.warn(
      { market: market.toBase58(), ticker: tickerStr, earliest },
      "admin_settle fallback enabled, but override delay has not elapsed"
    );
    return false;
  }

  if (!isTicker(tickerStr)) {
    logger.error({ market: market.toBase58(), ticker: tickerStr }, "admin fallback ticker is not configured");
    return false;
  }
  const prices = await fetchLatestPrices(cfg.hermesUrl, {
    [tickerStr]: feedId,
  });
  const price = prices[tickerStr];
  if (!price) {
    logger.error({ market: market.toBase58(), ticker: tickerStr }, "admin fallback missing Hermes price");
    return false;
  }

  const priceUsdCents = pythPriceToUsdCents(price);
  await ctx.program.methods
    .adminSettle(new anchor.BN(priceUsdCents))
    .accounts({
      admin: ctx.wallet.publicKey,
      config: configKey,
      market,
    })
    .rpc();

  logger.warn(
    { market: market.toBase58(), ticker: tickerStr, priceUsdCents },
    "settled with admin_settle fallback"
  );
  return true;
}

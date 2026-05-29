// Morning job: read previous close per ticker, compute strikes, call
// create_strike_market for each. Runs ~8am ET, Mon-Fri excluding holidays.
//
// Idempotency: create_strike_market is gated by the (ticker, strike, expiry)
// PDA, so re-running mid-morning won't duplicate markets — Anchor's `init`
// will fail-with-already-in-use for any market created earlier. We log and
// continue.
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Config, TICKERS } from "../config.js";
import { readKeypairBytes } from "../config.js";
import { ProgramContext } from "../program.js";
import { logger } from "../logger.js";
import { isNyseTradingDay } from "../calendar.js";
import { fetchLatestPrices, pythPriceToUsdCents, hexToFeedIdBytes } from "../pyth.js";
import { calculateStrikes } from "../strikes.js";

function tickerBytes(t: string): number[] {
  const b = Buffer.alloc(8);
  Buffer.from(t, "ascii").copy(b, 0, 0, Math.min(t.length, 8));
  return Array.from(b);
}

/// Expiry timestamp for today's contracts: 4:05 PM US Eastern.
function todaysExpiryTs(now: Date = new Date()): number {
  // Pick today's date in ET, then compose 16:05 ET as a UTC instant.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  // Build the ET timestamp string and parse via Date — JS will treat the
  // offset based on DST. For correctness we explicitly compute the offset.
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T16:05:00`);
  // Adjust for ET offset by formatting the same instant in ET and checking.
  // Quick approach: ET is UTC-5 (EST) or UTC-4 (EDT). Use Intl to get the offset.
  const offsetMinutes = etOffsetMinutes(now);
  return Math.floor((date.getTime() - offsetMinutes * 60 * 1000) / 1000);
}

function etOffsetMinutes(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  });
  const parts = dtf.formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(tz);
  if (!match) return -300; // default EST
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  return h * 60 + (h < 0 ? -m : m);
}

function etMinutes(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function isAfterRegularOpenEt(d: Date): boolean {
  return etMinutes(d) >= 9 * 60 + 30;
}

export async function runMorningJob(cfg: Config, ctx: ProgramContext): Promise<void> {
  const now = new Date();
  if (!isNyseTradingDay(now)) {
    logger.info({ date: now.toISOString() }, "skipping morning job: not a trading day");
    return;
  }
  if (!cfg.morningAllowAfterOpen && isAfterRegularOpenEt(now)) {
    logger.warn(
      { date: now.toISOString() },
      "skipping morning job after regular market open; set MORNING_ALLOW_AFTER_OPEN=true to override"
    );
    return;
  }

  const admin = anchor.web3.Keypair.fromSecretKey(readKeypairBytes(cfg.adminKeypairPath));
  const prices = await fetchLatestPrices(cfg.hermesUrl, cfg.feedIds);
  const expiry = todaysExpiryTs(now);
  const configKey = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    ctx.program.programId
  )[0];

  for (const t of TICKERS) {
    const feedId = cfg.feedIds[t];
    const price = prices[t];
    if (!feedId || !price) {
      logger.warn({ ticker: t }, "no Pyth feed or price; skipping ticker");
      continue;
    }
    const prevCloseCents = pythPriceToUsdCents(price);
    const strikes = calculateStrikes(prevCloseCents, {
      percentages: cfg.strikePercentages,
      roundToCents: cfg.strikeRoundToCents,
    });
    const feedIdBytes = hexToFeedIdBytes(feedId);

    logger.info({ ticker: t, prevCloseCents, strikes }, "creating strikes");

    for (const strike of strikes) {
      try {
        const tb = tickerBytes(t);
        const [market] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            Buffer.from(tb),
            new BN(strike).toArrayLike(Buffer, "le", 8),
            new BN(expiry).toArrayLike(Buffer, "le", 8),
          ],
          ctx.program.programId
        );
        const [yesMint] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("yes"), market.toBuffer()],
          ctx.program.programId
        );
        const [noMint] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("no"), market.toBuffer()],
          ctx.program.programId
        );
        const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), market.toBuffer()],
          ctx.program.programId
        );

        await ctx.program.methods
          .createStrikeMarket(tb, new BN(strike), new BN(expiry), feedIdBytes)
          .accounts({
            admin: admin.publicKey,
            config: configKey,
            market,
            yesMint,
            noMint,
            vault,
            usdcMint: cfg.usdcMint,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          })
          .signers([admin])
          .rpc();
        logger.info({ ticker: t, strike, market: market.toBase58() }, "market created");
      } catch (err: any) {
        // Already-created markets surface as "already in use" — treat as success.
        if (err.message?.includes("already in use") || err.message?.includes("custom program error: 0x0")) {
          logger.info({ ticker: t, strike }, "market already exists; skipping");
          continue;
        }
        logger.error({ ticker: t, strike, err: err.message }, "create_strike_market failed");
      }
    }
  }
  logger.info("morning job complete");
}

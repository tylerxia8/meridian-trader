use crate::errors::MeridianError;
use crate::state::{Config, Market, Outcome};
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    /// Permissionless — anyone can call once expiry is reached, as long as
    /// the oracle data passes staleness + confidence checks.
    pub caller: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [
            Market::SEED,
            market.ticker.as_ref(),
            &market.strike_price_usd_cents.to_le_bytes(),
            &market.expiry_ts.to_le_bytes(),
        ],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    pub price_update: Account<'info, PriceUpdateV2>,
}

pub fn handler(ctx: Context<SettleMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let config = &ctx.accounts.config;
    require!(market.outcome == Outcome::Unsettled, MeridianError::AlreadySettled);

    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= market.expiry_ts, MeridianError::NotExpired);

    // get_price_no_older_than validates staleness AND that the price update is
    // for the expected feed id — handles two of our three checks in one call.
    let price = ctx
        .accounts
        .price_update
        .get_price_no_older_than(&clock, config.max_staleness_secs as u64, &market.price_feed_id)
        .map_err(|_| error!(MeridianError::OracleStale))?;

    // Confidence check: conf / price <= max_conf_ratio_bps / 10_000.
    // Equivalent to: conf * 10_000 <= price * max_conf_ratio_bps.
    require!(price.price > 0, MeridianError::OracleConfTooWide);
    let abs_price: u128 = (price.price as i128).unsigned_abs();
    let conf: u128 = price.conf as u128;
    let lhs = conf
        .checked_mul(10_000)
        .ok_or(MeridianError::MathOverflow)?;
    let rhs = abs_price
        .checked_mul(config.max_conf_ratio_bps as u128)
        .ok_or(MeridianError::MathOverflow)?;
    require!(lhs <= rhs, MeridianError::OracleConfTooWide);

    let price_usd_cents = pyth_price_to_usd_cents(price.price, price.exponent)?;
    finalize_settlement(market, price_usd_cents, clock.unix_timestamp);
    Ok(())
}

/// Converts a Pyth price (price, expo) into USD cents (u64).
///
/// actual_usd  = price * 10^expo
/// usd_cents   = actual_usd * 100 = price * 10^(expo + 2)
///
/// If `expo + 2 >= 0` we multiply; otherwise we divide (truncating). For
/// typical equity feeds (expo = -8) this means we divide by 10^6, losing
/// sub-cent precision — fine for our $10-rounded strikes.
pub fn pyth_price_to_usd_cents(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, MeridianError::OracleConfTooWide);
    let p: u128 = price as u128;
    let adj: i32 = expo
        .checked_add(2)
        .ok_or(MeridianError::MathOverflow)?;
    let cents: u128 = if adj >= 0 {
        let scale = 10u128
            .checked_pow(adj as u32)
            .ok_or(MeridianError::MathOverflow)?;
        p.checked_mul(scale).ok_or(MeridianError::MathOverflow)?
    } else {
        let scale = 10u128
            .checked_pow((-adj) as u32)
            .ok_or(MeridianError::MathOverflow)?;
        p / scale
    };
    u64::try_from(cents).map_err(|_| error!(MeridianError::MathOverflow))
}

/// Writes the outcome and settlement metadata. Used by both settle_market
/// (oracle path) and admin_settle (override path).
pub fn finalize_settlement(market: &mut Market, price_usd_cents: u64, now_ts: i64) {
    market.outcome = if price_usd_cents >= market.strike_price_usd_cents {
        Outcome::YesWins
    } else {
        Outcome::NoWins
    };
    market.settlement_price_usd_cents = price_usd_cents;
    market.settled_at = now_ts;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyth_price_at_minus_two_expo_is_already_cents() {
        // price = 68012, expo = -2 -> $680.12 -> 68_012 cents
        assert_eq!(pyth_price_to_usd_cents(68_012, -2).unwrap(), 68_012);
    }

    #[test]
    fn pyth_price_at_minus_eight_expo_divides_by_million() {
        // price = 68_012_000_000, expo = -8 -> $680.12 -> 68012 cents (truncated)
        assert_eq!(
            pyth_price_to_usd_cents(68_012_000_000, -8).unwrap(),
            68_012
        );
    }

    #[test]
    fn pyth_price_at_zero_expo_multiplies_by_hundred() {
        // price = 680, expo = 0 -> $680 -> 68_000 cents
        assert_eq!(pyth_price_to_usd_cents(680, 0).unwrap(), 68_000);
    }

    #[test]
    fn pyth_price_negative_rejected() {
        assert!(pyth_price_to_usd_cents(-100, -2).is_err());
    }
}

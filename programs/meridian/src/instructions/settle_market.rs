// Pyth-oracle settlement path.
//
// Status: STUBBED. The Pyth SDK on crates.io (pyth-solana-receiver-sdk 1.2.0)
// has an internal borsh-version mismatch that prevents it from compiling
// against Anchor 1.0. Until a compatible Pyth SDK ships, settlement runs
// exclusively through `admin_settle`, which is functionally complete
// (validates expiry + override delay, computes outcome the same way).
//
// The pure helper functions (`pyth_price_to_usd_cents`, `finalize_settlement`)
// stay in this file because admin_settle imports `finalize_settlement` and the
// Pyth math is still tested by Rust unit tests below.

use crate::errors::MeridianError;
use crate::state::{Config, Market, Outcome};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SettleMarket<'info> {
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

    /// CHECK: Will be the Pyth PriceUpdateV2 account once the Pyth SDK is
    /// compatible with Anchor 1.0. Currently unused — handler returns
    /// Unimplemented.
    pub price_update: UncheckedAccount<'info>,
}

pub fn settle_market_handler(_ctx: Context<SettleMarket>) -> Result<()> {
    // Pyth SDK compatibility blocker — see file header.
    err!(MeridianError::OracleStale)
}

/// Writes the outcome and settlement metadata. Used by both settle_market
/// (oracle path, when restored) and admin_settle (override path).
pub fn finalize_settlement(market: &mut Market, price_usd_cents: u64, now_ts: i64) {
    market.outcome = if price_usd_cents >= market.strike_price_usd_cents {
        Outcome::YesWins
    } else {
        Outcome::NoWins
    };
    market.settlement_price_usd_cents = price_usd_cents;
    market.settled_at = now_ts;
}

/// Pyth's (price, expo) into USD cents (u64). Kept for the eventual oracle
/// path and exercised by the unit tests below.
///
/// actual_usd  = price * 10^expo
/// usd_cents   = actual_usd * 100 = price * 10^(expo + 2)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyth_price_at_minus_two_expo_is_already_cents() {
        assert_eq!(pyth_price_to_usd_cents(68_012, -2).unwrap(), 68_012);
    }

    #[test]
    fn pyth_price_at_minus_eight_expo_divides_by_million() {
        assert_eq!(pyth_price_to_usd_cents(68_012_000_000, -8).unwrap(), 68_012);
    }

    #[test]
    fn pyth_price_at_zero_expo_multiplies_by_hundred() {
        assert_eq!(pyth_price_to_usd_cents(680, 0).unwrap(), 68_000);
    }

    #[test]
    fn pyth_price_negative_rejected() {
        assert!(pyth_price_to_usd_cents(-100, -2).is_err());
    }
}

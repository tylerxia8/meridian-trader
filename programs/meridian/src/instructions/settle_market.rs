use crate::errors::MeridianError;
use crate::state::{Config, Market, Outcome};
use anchor_lang::prelude::*;

const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
const VERIFICATION_LEVEL_PARTIAL: u8 = 0;
const VERIFICATION_LEVEL_FULL: u8 = 1;

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

    /// CHECK: Manually parsed as a Pyth Receiver PriceUpdateV2 account. This
    /// avoids pulling the Pyth SDK's Anchor version into the on-chain program.
    pub price_update: UncheckedAccount<'info>,
}

pub fn settle_market_handler(ctx: Context<SettleMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let config = &ctx.accounts.config;
    require!(
        market.outcome == Outcome::Unsettled,
        MeridianError::AlreadySettled
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= market.expiry_ts,
        MeridianError::NotExpired
    );
    require_keys_eq!(
        *ctx.accounts.price_update.owner,
        PYTH_RECEIVER_PROGRAM_ID,
        MeridianError::InvalidOracleAccount
    );

    let parsed = parse_price_update_v2(&ctx.accounts.price_update.data.borrow())?;
    require!(
        parsed.verification_level == VERIFICATION_LEVEL_FULL,
        MeridianError::InvalidOracleAccount
    );
    require!(
        parsed.feed_id == market.price_feed_id,
        MeridianError::OracleFeedMismatch
    );

    let latest_valid_time = parsed
        .publish_time
        .checked_add(config.max_staleness_secs as i64)
        .ok_or(MeridianError::MathOverflow)?;
    require!(
        latest_valid_time >= clock.unix_timestamp,
        MeridianError::OracleStale
    );
    require!(parsed.price > 0, MeridianError::OracleConfTooWide);

    let conf_ratio_lhs = (parsed.conf as u128)
        .checked_mul(10_000)
        .ok_or(MeridianError::MathOverflow)?;
    let conf_ratio_rhs = (parsed.price as u128)
        .checked_mul(config.max_conf_ratio_bps as u128)
        .ok_or(MeridianError::MathOverflow)?;
    require!(
        conf_ratio_lhs <= conf_ratio_rhs,
        MeridianError::OracleConfTooWide
    );

    let price_usd_cents = pyth_price_to_usd_cents(parsed.price, parsed.exponent)?;
    finalize_settlement(market, price_usd_cents, clock.unix_timestamp);
    Ok(())
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

/// Convert Pyth's (price, expo) into USD cents.
///
/// actual_usd = price * 10^expo
/// usd_cents  = actual_usd * 100 = price * 10^(expo + 2)
pub fn pyth_price_to_usd_cents(price: i64, expo: i32) -> Result<u64> {
    require!(price > 0, MeridianError::OracleConfTooWide);
    let p: u128 = price as u128;
    let adj: i32 = expo.checked_add(2).ok_or(MeridianError::MathOverflow)?;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ParsedPriceUpdate {
    feed_id: [u8; 32],
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    verification_level: u8,
}

fn parse_price_update_v2(data: &[u8]) -> Result<ParsedPriceUpdate> {
    require!(
        data.len() >= PriceUpdateLayout::MIN_FULL_LEN,
        MeridianError::InvalidOracleAccount
    );
    require!(
        data[0..8] == PRICE_UPDATE_V2_DISCRIMINATOR,
        MeridianError::InvalidOracleAccount
    );

    let verification_level = data[PriceUpdateLayout::VERIFICATION_TAG_OFFSET];
    let price_message_offset = match verification_level {
        VERIFICATION_LEVEL_PARTIAL => PriceUpdateLayout::PRICE_MESSAGE_OFFSET_PARTIAL,
        VERIFICATION_LEVEL_FULL => PriceUpdateLayout::PRICE_MESSAGE_OFFSET_FULL,
        _ => return err!(MeridianError::InvalidOracleAccount),
    };
    require!(
        data.len() >= price_message_offset + PriceUpdateLayout::PRICE_MESSAGE_LEN,
        MeridianError::InvalidOracleAccount
    );

    let mut feed_id = [0u8; 32];
    feed_id.copy_from_slice(&data[price_message_offset..price_message_offset + 32]);
    let price = read_i64_le(data, price_message_offset + 32)?;
    let conf = read_u64_le(data, price_message_offset + 40)?;
    let exponent = read_i32_le(data, price_message_offset + 48)?;
    let publish_time = read_i64_le(data, price_message_offset + 52)?;

    Ok(ParsedPriceUpdate {
        feed_id,
        price,
        conf,
        exponent,
        publish_time,
        verification_level,
    })
}

struct PriceUpdateLayout;

impl PriceUpdateLayout {
    const VERIFICATION_TAG_OFFSET: usize = 40;
    const PRICE_MESSAGE_OFFSET_PARTIAL: usize = 42;
    const PRICE_MESSAGE_OFFSET_FULL: usize = 41;
    const PRICE_MESSAGE_LEN: usize = 84;
    const MIN_FULL_LEN: usize = Self::PRICE_MESSAGE_OFFSET_FULL + Self::PRICE_MESSAGE_LEN;
}

fn read_i64_le(data: &[u8], offset: usize) -> Result<i64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(MeridianError::InvalidOracleAccount)?
        .try_into()
        .map_err(|_| error!(MeridianError::InvalidOracleAccount))?;
    Ok(i64::from_le_bytes(bytes))
}

fn read_u64_le(data: &[u8], offset: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(MeridianError::InvalidOracleAccount)?
        .try_into()
        .map_err(|_| error!(MeridianError::InvalidOracleAccount))?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_i32_le(data: &[u8], offset: usize) -> Result<i32> {
    let bytes: [u8; 4] = data
        .get(offset..offset + 4)
        .ok_or(MeridianError::InvalidOracleAccount)?
        .try_into()
        .map_err(|_| error!(MeridianError::InvalidOracleAccount))?;
    Ok(i32::from_le_bytes(bytes))
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

    #[test]
    fn parses_full_price_update_layout() {
        let mut data = vec![0u8; 134];
        data[0..8].copy_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
        data[PriceUpdateLayout::VERIFICATION_TAG_OFFSET] = VERIFICATION_LEVEL_FULL;
        let offset = PriceUpdateLayout::PRICE_MESSAGE_OFFSET_FULL;
        let feed_id = [7u8; 32];
        data[offset..offset + 32].copy_from_slice(&feed_id);
        data[offset + 32..offset + 40].copy_from_slice(&68_012_000_000i64.to_le_bytes());
        data[offset + 40..offset + 48].copy_from_slice(&100_000u64.to_le_bytes());
        data[offset + 48..offset + 52].copy_from_slice(&(-8i32).to_le_bytes());
        data[offset + 52..offset + 60].copy_from_slice(&1_700_000_000i64.to_le_bytes());

        let parsed = parse_price_update_v2(&data).unwrap();
        assert_eq!(parsed.feed_id, feed_id);
        assert_eq!(parsed.price, 68_012_000_000);
        assert_eq!(parsed.conf, 100_000);
        assert_eq!(parsed.exponent, -8);
        assert_eq!(parsed.publish_time, 1_700_000_000);
        assert_eq!(parsed.verification_level, VERIFICATION_LEVEL_FULL);
    }
}

use crate::errors::MeridianError;
use crate::instructions::settle_market::finalize_settlement;
use crate::state::{Config, Market, Outcome};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AdminSettle<'info> {
    #[account(address = config.admin @ MeridianError::NotAdmin)]
    pub admin: Signer<'info>,

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
}

pub fn admin_settle_handler(ctx: Context<AdminSettle>, price_usd_cents: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let config = &ctx.accounts.config;
    require!(market.outcome == Outcome::Unsettled, MeridianError::AlreadySettled);
    require!(price_usd_cents > 0, MeridianError::InvalidSettlementPrice);

    let now = Clock::get()?.unix_timestamp;
    let earliest = market
        .expiry_ts
        .checked_add(config.admin_override_delay_secs as i64)
        .ok_or(MeridianError::MathOverflow)?;
    require!(now >= earliest, MeridianError::AdminOverrideTooEarly);

    finalize_settlement(market, price_usd_cents, now);
    Ok(())
}

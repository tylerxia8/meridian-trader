use crate::errors::MeridianError;
use crate::state::{Config, Market};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct LinkPhoenixMarket<'info> {
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

pub fn link_phoenix_market_handler(ctx: Context<LinkPhoenixMarket>, phoenix_market: Pubkey) -> Result<()> {
    let market = &mut ctx.accounts.market;
    market.phoenix_market = phoenix_market;
    Ok(())
}

use crate::errors::MeridianError;
use crate::state::{Config, Market, Outcome};
use crate::TOKEN_DECIMALS;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(ticker: [u8; 8], strike_price_usd_cents: u64, expiry_ts: i64, price_feed_id: [u8; 32])]
pub struct CreateStrikeMarket<'info> {
    #[account(
        mut,
        address = config.admin @ MeridianError::NotAdmin,
    )]
    pub admin: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [
            Market::SEED,
            ticker.as_ref(),
            &strike_price_usd_cents.to_le_bytes(),
            &expiry_ts.to_le_bytes(),
        ],
        bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = admin,
        seeds = [Market::YES_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [Market::NO_MINT_SEED, market.key().as_ref()],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = market,
    )]
    pub no_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [Market::VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(address = config.usdc_mint)]
    pub usdc_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateStrikeMarket>,
    ticker: [u8; 8],
    strike_price_usd_cents: u64,
    expiry_ts: i64,
    price_feed_id: [u8; 32],
) -> Result<()> {
    require!(ticker[0].is_ascii_uppercase(), MeridianError::InvalidTicker);
    require!(strike_price_usd_cents > 0, MeridianError::InvalidStrike);
    let now = Clock::get()?.unix_timestamp;
    require!(expiry_ts > now, MeridianError::InvalidExpiry);

    let market = &mut ctx.accounts.market;
    market.config = ctx.accounts.config.key();
    market.ticker = ticker;
    market.strike_price_usd_cents = strike_price_usd_cents;
    market.expiry_ts = expiry_ts;
    market.yes_mint = ctx.accounts.yes_mint.key();
    market.no_mint = ctx.accounts.no_mint.key();
    market.vault = ctx.accounts.vault.key();
    market.phoenix_market = Pubkey::default();
    market.price_feed_id = price_feed_id;
    market.outcome = Outcome::Unsettled;
    market.settlement_price_usd_cents = 0;
    market.settled_at = 0;
    market.created_at = now;
    market.bump = ctx.bumps.market;
    Ok(())
}

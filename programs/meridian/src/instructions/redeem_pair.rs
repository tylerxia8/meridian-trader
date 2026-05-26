use crate::errors::MeridianError;
use crate::state::{Config, Market};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct RedeemPair<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [
            Market::SEED,
            market.ticker.as_ref(),
            &market.strike_price_usd_cents.to_le_bytes(),
            &market.expiry_ts.to_le_bytes(),
        ],
        bump = market.bump,
    )]
    pub market: Box<Account<'info, Market>>,

    #[account(mut, address = market.yes_mint)]
    pub yes_mint: Box<Account<'info, Mint>>,

    #[account(mut, address = market.no_mint)]
    pub no_mint: Box<Account<'info, Mint>>,

    #[account(mut, address = market.vault)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_usdc.mint == config.usdc_mint,
        constraint = user_usdc.owner == user.key(),
    )]
    pub user_usdc: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_yes.mint == market.yes_mint,
        constraint = user_yes.owner == user.key(),
    )]
    pub user_yes: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = user_no.mint == market.no_mint,
        constraint = user_no.owner == user.key(),
    )]
    pub user_no: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

pub fn redeem_pair_handler(ctx: Context<RedeemPair>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, MeridianError::Paused);
    require!(amount > 0, MeridianError::ZeroAmount);

    // 1. Burn `amount` Yes from the user.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.yes_mint.to_account_info(),
                from: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. Burn `amount` No from the user.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.no_mint.to_account_info(),
                from: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 3. Return `amount` USDC to the user. Market PDA signs the vault transfer.
    let market = &ctx.accounts.market;
    let ticker = market.ticker;
    let strike_le = market.strike_price_usd_cents.to_le_bytes();
    let expiry_le = market.expiry_ts.to_le_bytes();
    let bump = [market.bump];
    let signer_seeds: [&[u8]; 5] = [
        Market::SEED,
        ticker.as_ref(),
        &strike_le,
        &expiry_le,
        &bump,
    ];
    let signer = &[&signer_seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    Ok(())
}

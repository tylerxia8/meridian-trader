use crate::state::Config;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [Config::SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub usdc_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    max_staleness_secs: u32,
    max_conf_ratio_bps: u16,
    admin_override_delay_secs: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.paused = false;
    config.max_staleness_secs = max_staleness_secs;
    config.max_conf_ratio_bps = max_conf_ratio_bps;
    config.admin_override_delay_secs = admin_override_delay_secs;
    config.bump = ctx.bumps.config;
    Ok(())
}

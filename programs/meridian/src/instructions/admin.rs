use crate::errors::MeridianError;
use crate::state::Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct AdminToggle<'info> {
    #[account(address = config.admin @ MeridianError::NotAdmin)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

pub fn pause_handler(ctx: Context<AdminToggle>) -> Result<()> {
    ctx.accounts.config.paused = true;
    Ok(())
}

pub fn unpause_handler(ctx: Context<AdminToggle>) -> Result<()> {
    ctx.accounts.config.paused = false;
    Ok(())
}

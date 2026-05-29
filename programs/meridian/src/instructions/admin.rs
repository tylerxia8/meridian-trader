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

#[derive(Accounts)]
pub struct AdminUpdateConfig<'info> {
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

pub fn update_config_handler(
    ctx: Context<AdminUpdateConfig>,
    max_staleness_secs: u32,
    max_conf_ratio_bps: u16,
    admin_override_delay_secs: u32,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.max_staleness_secs = max_staleness_secs;
    config.max_conf_ratio_bps = max_conf_ratio_bps;
    config.admin_override_delay_secs = admin_override_delay_secs;
    Ok(())
}

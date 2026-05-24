use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::{
    AdminSettle, AdminToggle, CreateStrikeMarket, InitializeConfig, MintPair, RedeemNo, RedeemPair,
    RedeemYes, SettleMarket,
};

// Placeholder. After first `anchor build`, run `anchor keys sync` to replace
// this with the program ID derived from `target/deploy/meridian-keypair.json`.
declare_id!("11111111111111111111111111111111");

// USDC has 6 decimals. We give Yes/No the same so that
// `vault.amount == yes_mint.supply == no_mint.supply` is the natural
// raw-units invariant (no scaling factor).
pub const TOKEN_DECIMALS: u8 = 6;

#[program]
pub mod meridian {
    use super::*;

    /// One-time global setup. Records the admin authority, the USDC mint
    /// every market collateralizes against, and oracle / override config.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_staleness_secs: u32,
        max_conf_ratio_bps: u16,
        admin_override_delay_secs: u32,
    ) -> Result<()> {
        instructions::initialize_config::handler(
            ctx,
            max_staleness_secs,
            max_conf_ratio_bps,
            admin_override_delay_secs,
        )
    }

    /// Create one strike market: Yes mint, No mint, USDC vault, and the
    /// per-day Market account. Admin-only. `price_feed_id` is the Pyth
    /// feed used at settlement; checked against the PriceUpdateV2 account.
    pub fn create_strike_market(
        ctx: Context<CreateStrikeMarket>,
        ticker: [u8; 8],
        strike_price_usd_cents: u64,
        expiry_ts: i64,
        price_feed_id: [u8; 32],
    ) -> Result<()> {
        instructions::create_strike_market::handler(
            ctx,
            ticker,
            strike_price_usd_cents,
            expiry_ts,
            price_feed_id,
        )
    }

    /// Deposit `amount` of USDC (raw units; 1.00 USDC = 1_000_000). The
    /// caller receives `amount` of both Yes and No tokens. Blocked if the
    /// market is already settled.
    pub fn mint_pair(ctx: Context<MintPair>, amount: u64) -> Result<()> {
        instructions::mint_pair::handler(ctx, amount)
    }

    /// Burn `amount` of Yes AND `amount` of No (the caller must hold both),
    /// receive `amount` of USDC back. Works pre- or post-settlement —
    /// a matched pair is always worth $1.00 by the invariant.
    pub fn redeem_pair(ctx: Context<RedeemPair>, amount: u64) -> Result<()> {
        instructions::redeem_pair::handler(ctx, amount)
    }

    /// Permissionless. Reads Pyth's closing price for the market's feed,
    /// validates staleness + confidence, writes the binary outcome.
    /// Outcome is immutable once written.
    pub fn settle_market(ctx: Context<SettleMarket>) -> Result<()> {
        instructions::settle_market::handler(ctx)
    }

    /// Admin override for the case where Pyth is unreliable. Enforces a
    /// time delay (config.admin_override_delay_secs) since market expiry
    /// before it can be invoked. Outcome is immutable once written.
    pub fn admin_settle(ctx: Context<AdminSettle>, price_usd_cents: u64) -> Result<()> {
        instructions::admin_settle::handler(ctx, price_usd_cents)
    }

    /// Post-settlement: burn winning Yes tokens, receive $1.00 USDC each.
    pub fn redeem_yes(ctx: Context<RedeemYes>, amount: u64) -> Result<()> {
        instructions::redeem_winning::redeem_yes(ctx, amount)
    }

    /// Post-settlement: burn winning No tokens, receive $1.00 USDC each.
    pub fn redeem_no(ctx: Context<RedeemNo>, amount: u64) -> Result<()> {
        instructions::redeem_winning::redeem_no(ctx, amount)
    }

    /// Admin: halt mint_pair and all redeem operations. Settlement is
    /// independent and continues even when paused.
    pub fn pause(ctx: Context<AdminToggle>) -> Result<()> {
        instructions::admin::pause(ctx)
    }

    /// Admin: resume mint_pair and redeem operations.
    pub fn unpause(ctx: Context<AdminToggle>) -> Result<()> {
        instructions::admin::unpause(ctx)
    }
}

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::{
    AdminToggle, CreateStrikeMarket, InitializeConfig, MintPair, RedeemPair,
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

    /// One-time global setup. Stores the admin authority and the USDC mint
    /// every market will collateralize against.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        instructions::initialize_config::handler(ctx)
    }

    /// Create one strike market: Yes mint, No mint, USDC vault, and the
    /// per-day Market account. Admin-only.
    pub fn create_strike_market(
        ctx: Context<CreateStrikeMarket>,
        ticker: [u8; 8],
        strike_price_usd_cents: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        instructions::create_strike_market::handler(ctx, ticker, strike_price_usd_cents, expiry_ts)
    }

    /// Deposit `amount` of USDC (raw units; 1.00 USDC = 1_000_000). The
    /// caller receives `amount` of both Yes and No tokens.
    pub fn mint_pair(ctx: Context<MintPair>, amount: u64) -> Result<()> {
        instructions::mint_pair::handler(ctx, amount)
    }

    /// Burn `amount` of Yes AND `amount` of No (the caller must hold both),
    /// receive `amount` of USDC back. Works pre- or post-settlement —
    /// a matching pair is always worth $1.00 by the invariant.
    pub fn redeem_pair(ctx: Context<RedeemPair>, amount: u64) -> Result<()> {
        instructions::redeem_pair::handler(ctx, amount)
    }

    /// Admin: halt mint_pair and redeem_pair. Trading on Phoenix is independent.
    pub fn pause(ctx: Context<AdminToggle>) -> Result<()> {
        instructions::admin::pause(ctx)
    }

    /// Admin: resume mint_pair and redeem_pair.
    pub fn unpause(ctx: Context<AdminToggle>) -> Result<()> {
        instructions::admin::unpause(ctx)
    }

    // settle_market, admin_settle, and redeem_winning land in Phase 3
    // when Pyth integration arrives.
}

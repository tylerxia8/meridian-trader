use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

// Glob-import instructions so:
// 1. Accounts structs (MintPair, RedeemPair, ...) are in scope here.
// 2. Auto-generated __client_accounts_* / __cpi_client_accounts_* modules
//    are at the crate root, which Anchor 1.0's #[program] macro requires.
// 3. Renamed handler functions (mint_pair_handler, redeem_pair_handler, ...)
//    are callable directly without a module prefix.
pub use instructions::*;

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
        initialize_config_handler(ctx, max_staleness_secs, max_conf_ratio_bps, admin_override_delay_secs)
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
        create_strike_market_handler(ctx, ticker, strike_price_usd_cents, expiry_ts, price_feed_id)
    }

    /// Deposit `amount` of USDC (raw units; 1.00 USDC = 1_000_000). The
    /// caller receives `amount` of both Yes and No tokens. Blocked if the
    /// market is already settled.
    pub fn mint_pair(ctx: Context<MintPair>, amount: u64) -> Result<()> {
        mint_pair_handler(ctx, amount)
    }

    /// Burn `amount` of Yes AND `amount` of No (the caller must hold both),
    /// receive `amount` of USDC back. Works pre- or post-settlement —
    /// a matched pair is always worth $1.00 by the invariant.
    pub fn redeem_pair(ctx: Context<RedeemPair>, amount: u64) -> Result<()> {
        redeem_pair_handler(ctx, amount)
    }

    /// Currently stubbed (returns an error). Pyth SDK is not Anchor-1.0
    /// compatible yet — see docs/ARCHITECTURE.md. Use admin_settle instead.
    pub fn settle_market(ctx: Context<SettleMarket>) -> Result<()> {
        settle_market_handler(ctx)
    }

    /// Admin override. Enforces a time delay
    /// (config.admin_override_delay_secs) since market expiry. Currently
    /// the only working settlement path. Outcome is immutable once written.
    pub fn admin_settle(ctx: Context<AdminSettle>, price_usd_cents: u64) -> Result<()> {
        admin_settle_handler(ctx, price_usd_cents)
    }

    /// Post-settlement: burn winning Yes tokens, receive $1.00 USDC each.
    pub fn redeem_yes(ctx: Context<RedeemYes>, amount: u64) -> Result<()> {
        redeem_yes_handler(ctx, amount)
    }

    /// Post-settlement: burn winning No tokens, receive $1.00 USDC each.
    pub fn redeem_no(ctx: Context<RedeemNo>, amount: u64) -> Result<()> {
        redeem_no_handler(ctx, amount)
    }

    /// Admin: associate this strike's Phoenix CLOB market (Yes vs USDC)
    /// with the Market account. The Phoenix market itself is created
    /// off-chain via the Phoenix SDK before this is called.
    pub fn link_phoenix_market(ctx: Context<LinkPhoenixMarket>, phoenix_market: Pubkey) -> Result<()> {
        link_phoenix_market_handler(ctx, phoenix_market)
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

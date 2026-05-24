use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Authority that can create markets, pause/unpause, and (after delay) override-settle.
    pub admin: Pubkey,
    /// USDC mint every market collateralizes against.
    pub usdc_mint: Pubkey,
    /// When true, mint_pair and redeem operations revert. Settlement still proceeds.
    pub paused: bool,
    /// Reject oracle prices older than this at settlement time.
    pub max_staleness_secs: u32,
    /// Reject oracle prices whose conf/price ratio exceeds this in basis points.
    /// 50 bps = 0.50%.
    pub max_conf_ratio_bps: u16,
    /// Seconds after market.expiry_ts before admin_settle can be invoked.
    pub admin_override_delay_secs: u32,
    /// PDA bump for ["config"].
    pub bump: u8,
}

impl Config {
    pub const SEED: &'static [u8] = b"config";
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub config: Pubkey,
    /// Right-padded with 0x00 to 8 bytes (e.g. "AAPL\0\0\0\0").
    pub ticker: [u8; 8],
    /// Strike in USD cents to avoid floats on-chain. $230.00 = 23_000.
    pub strike_price_usd_cents: u64,
    /// Unix timestamp of 4:05 PM ET on the trading day this market expires.
    pub expiry_ts: i64,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
    pub vault: Pubkey,
    /// Phoenix CLOB market address for this strike (Yes/USDC). All four trade
    /// paths route through this single book. `Pubkey::default()` means
    /// "not yet linked" — admin calls `link_phoenix_market` after creating
    /// the Phoenix market off-chain.
    pub phoenix_market: Pubkey,
    /// Pyth feed id (32 bytes, hex-decoded). Verified against PriceUpdateV2 at settlement.
    pub price_feed_id: [u8; 32],
    pub outcome: Outcome,
    /// Closing price written at settlement time, in USD cents. Zero pre-settlement.
    pub settlement_price_usd_cents: u64,
    pub settled_at: i64,
    pub created_at: i64,
    pub bump: u8,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";
    pub const YES_MINT_SEED: &'static [u8] = b"yes";
    pub const NO_MINT_SEED: &'static [u8] = b"no";
    pub const VAULT_SEED: &'static [u8] = b"vault";
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Unsettled,
    YesWins,
    NoWins,
}

impl Default for Outcome {
    fn default() -> Self {
        Self::Unsettled
    }
}

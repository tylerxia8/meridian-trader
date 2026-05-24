use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Authority that can create markets, pause/unpause, and (after delay) override-settle.
    pub admin: Pubkey,
    /// USDC mint every market collateralizes against.
    pub usdc_mint: Pubkey,
    /// When true, mint_pair and redeem_pair revert. Settlement and oracle reads still proceed.
    pub paused: bool,
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
    pub outcome: Outcome,
    /// Closing price written at settlement time, in USD cents. Zero pre-settlement.
    pub settlement_price_usd_cents: u64,
    pub settled_at: i64,
    pub created_at: i64,
    /// PDA bump for ["market", ticker, strike_le, expiry_le].
    pub bump: u8,
}

impl Market {
    pub const SEED: &'static [u8] = b"market";
    pub const YES_MINT_SEED: &'static [u8] = b"yes";
    pub const NO_MINT_SEED: &'static [u8] = b"no";
    pub const VAULT_SEED: &'static [u8] = b"vault";

    pub fn signer_seeds<'a>(
        &'a self,
        ticker: &'a [u8; 8],
        strike_le: &'a [u8; 8],
        expiry_le: &'a [u8; 8],
        bump: &'a [u8; 1],
    ) -> [&'a [u8]; 5] {
        [Self::SEED, ticker.as_ref(), strike_le, expiry_le, bump]
    }
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

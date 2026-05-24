use anchor_lang::prelude::*;

#[error_code]
pub enum MeridianError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Caller is not the admin")]
    NotAdmin,
    #[msg("Mint or redeem amount must be greater than zero")]
    ZeroAmount,
    #[msg("Market is already settled; use redeem_winning for single-side redemption")]
    AlreadySettled,
    #[msg("Market is not yet settled")]
    NotSettled,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Ticker must be non-empty and start with an ASCII uppercase letter")]
    InvalidTicker,
    #[msg("Strike price must be greater than zero")]
    InvalidStrike,
    #[msg("Expiry must be in the future at creation time")]
    InvalidExpiry,
}

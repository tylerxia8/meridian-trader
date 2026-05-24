use anchor_lang::prelude::*;

#[error_code]
pub enum MeridianError {
    #[msg("Program is paused")]
    Paused,
    #[msg("Caller is not the admin")]
    NotAdmin,
    #[msg("Mint or redeem amount must be greater than zero")]
    ZeroAmount,
    #[msg("Market is already settled")]
    AlreadySettled,
    #[msg("Market is not yet settled")]
    NotSettled,
    #[msg("Market has not yet reached its expiry")]
    NotExpired,
    #[msg("Admin override is not yet available; wait until the override delay has elapsed")]
    AdminOverrideTooEarly,
    #[msg("Oracle price is stale beyond the configured threshold")]
    OracleStale,
    #[msg("Oracle confidence band is too wide")]
    OracleConfTooWide,
    #[msg("Oracle price update is for a different feed than this market")]
    OracleFeedMismatch,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Ticker must be non-empty and start with an ASCII uppercase letter")]
    InvalidTicker,
    #[msg("Strike price must be greater than zero")]
    InvalidStrike,
    #[msg("Expiry must be in the future at creation time")]
    InvalidExpiry,
    #[msg("Outcome of this market doesn't match the redemption side")]
    WrongOutcomeForRedemption,
}

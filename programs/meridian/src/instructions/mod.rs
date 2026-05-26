pub mod admin;
pub mod admin_settle;
pub mod create_strike_market;
pub mod initialize_config;
pub mod link_phoenix_market;
pub mod mint_pair;
pub mod redeem_no;
pub mod redeem_pair;
pub mod redeem_yes;
pub mod settle_market;

// Glob re-export each submodule's items (Accounts struct + auto-generated
// __client_accounts_* and __cpi_client_accounts_* modules) so they're
// reachable at `crate::*` after lib.rs does `pub use instructions::*`.
// Anchor 1.0's #[program] macro requires the auto-gen modules to be at
// the crate root.
pub use admin::*;
pub use admin_settle::*;
pub use create_strike_market::*;
pub use initialize_config::*;
pub use link_phoenix_market::*;
pub use mint_pair::*;
pub use redeem_no::*;
pub use redeem_pair::*;
pub use redeem_yes::*;
pub use settle_market::*;

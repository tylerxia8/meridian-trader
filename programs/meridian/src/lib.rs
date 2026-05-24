use anchor_lang::prelude::*;

declare_id!("Mer1d1an1111111111111111111111111111111111");

// Phase 1 scaffold: instruction surface only. Account contexts and bodies
// are implemented in Phase 2 (mint/redeem) and Phase 3 (oracle/settlement).
#[program]
pub mod meridian {
    use super::*;

    pub fn initialize_config(_ctx: Context<Initialize>) -> Result<()> {
        unimplemented!("Phase 2");
    }

    pub fn create_strike_market(
        _ctx: Context<Initialize>,
        _ticker: [u8; 8],
        _strike_price_usd_cents: u64,
        _expiry_ts: i64,
    ) -> Result<()> {
        unimplemented!("Phase 2");
    }

    pub fn mint_pair(_ctx: Context<Initialize>, _amount: u64) -> Result<()> {
        unimplemented!("Phase 2");
    }

    pub fn redeem(_ctx: Context<Initialize>, _amount: u64) -> Result<()> {
        unimplemented!("Phase 2");
    }

    pub fn settle_market(_ctx: Context<Initialize>) -> Result<()> {
        unimplemented!("Phase 3");
    }

    pub fn admin_settle(_ctx: Context<Initialize>, _price_usd_cents: u64) -> Result<()> {
        unimplemented!("Phase 3");
    }

    pub fn pause(_ctx: Context<Initialize>) -> Result<()> {
        unimplemented!("Phase 2");
    }

    pub fn unpause(_ctx: Context<Initialize>) -> Result<()> {
        unimplemented!("Phase 2");
    }
}

#[derive(Accounts)]
pub struct Initialize {}

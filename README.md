# Meridian — Binary Stock Outcome Markets on Solana

A non-custodial Solana dApp for trading binary outcome contracts on the daily closing prices of MAG7 US equities (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). Each contract asks *"Will [STOCK] close at or above [PRICE] today?"* and pays $1 USDC if yes, $0 if no. Contracts expire same-day (0DTE) and settle at 4:00 PM ET via the Pyth oracle. Yes and No tokens trade on Phoenix CLOB.

**Status:** compile-clean frontend/automation with a working local lifecycle demo, devnet Phoenix market creation/linking, and a live Phoenix order smoke. On-chain Pyth settlement is implemented by manually parsing posted Pyth Receiver `PriceUpdateV2` accounts; `admin_settle` remains the delayed fallback for demos and oracle outages.

## Architecture

```
┌──────────────────────┐    ┌─────────────────────┐    ┌───────────────────┐
│  Frontend (Next.js)  │    │  Automation (Node)  │    │   Phoenix CLOB    │
│  - Markets / Trade   │◄──►│  - Morning: create  │    │   (Yes vs USDC)   │
│  - Portfolio         │    │  - 4pm: settle      │    └─────────▲─────────┘
└──────────▲───────────┘    └──────────▲──────────┘              │
           │                           │                          │
           │      ┌────────────────────▼──────────────────────────▼─┐
           └─────►│   Meridian Anchor Program (Rust, Solana devnet) │
                  │   mint_pair · settle_market · redeem · admin    │
                  └────────────────────▲────────────────────────────┘
                                       │
                                  ┌────▼────┐
                                  │  Pyth   │
                                  └─────────┘
```

## Repo layout

```
programs/meridian/      Rust Anchor program (smart contract)
app/                    Next.js frontend (TypeScript + wallet-adapter)
automation/             Node.js cron service (market creation + settlement)
scripts/                Deployment + lifecycle demo scripts
tests/                  Anchor integration tests (TypeScript)
docs/                   Architecture decisions, trade-offs, risks
```

## Prerequisites

| Tool | Version | Verify |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| Rust | ≥ 1.75 | `rustc --version` |
| Solana CLI | ≥ 1.18 | `solana --version` |
| Anchor | ≥ 0.30 | `anchor --version` |

### On Windows (WSL strongly recommended)

The Solana toolchain has rough edges on native Windows. The most reliable path is WSL 2 + Ubuntu:

```powershell
# In PowerShell as Administrator (one-time):
wsl --install -d Ubuntu
# Restart, open Ubuntu, then continue inside WSL:
```

Then inside the WSL shell:

```bash
# Node.js 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Anchor (via AVM)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1

# Verify everything
node --version && rustc --version && solana --version && anchor --version
```

Clone this repo inside WSL too (don't mix Windows-path and WSL-path checkouts):

```bash
git clone https://github.com/tylerxia8/meridian-trader.git
cd meridian-trader
```

### On macOS / Linux

```bash
brew install node                              # macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.solana.com/v1.18.17/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1 && avm use 0.30.1
```

## First-build sanity check

Before running anything, verify the program compiles and the tests pass:

```bash
npm install --ignore-scripts         # native Windows avoids transitive postinstall shell issues
anchor build                         # compiles the Rust program
anchor keys sync                     # syncs the on-chain program ID into lib.rs + Anchor.toml
anchor test                          # runs the Anchor TS integration tests
cd automation && npm test            # runs the pure-TS strike calc tests
```

If `anchor build` complains about generated IDs, run `anchor keys sync` and rebuild.

## Quick start (devnet)

```bash
# 1. Generate keypairs (one-time)
mkdir -p keypairs
solana-keygen new -o ./keypairs/admin.json --no-bip39-passphrase
solana-keygen new -o ./keypairs/automation.json --no-bip39-passphrase
solana config set --url https://api.devnet.solana.com
solana airdrop 2 $(solana address -k ./keypairs/admin.json)
solana airdrop 2 $(solana address -k ./keypairs/automation.json)

# 2. Copy + fill env
cp .env.example .env
# Fill in PYTH_FEED_<TICKER> values from
# https://pyth.network/developers/price-feed-ids#solana-stable
# (Equities Stable section)

# 3. Deploy the program
anchor build
anchor deploy --provider.cluster devnet
# Copy the printed program id into MERIDIAN_PROGRAM_ID in .env

# 4. Run the lifecycle smoke demo
#    preflight -> initialize config if missing -> create demo market
#    -> mint/redeem if the admin wallet has demo USDC -> delayed admin_settle
#    -> winning-token redemption from a second wallet
npm run lifecycle:demo

# Optional: update deployed config parameters without reinitializing the PDA.
# For a full same-session admin-settle demo:
# ADMIN_OVERRIDE_DELAY_SECS=1 npm run config:update
# Restore the PRD default afterward:
# ADMIN_OVERRIDE_DELAY_SECS=3600 npm run config:update

# Local fast path: starts a temporary local validator, deploys Meridian,
# creates demo USDC, and runs the lifecycle smoke demo end-to-end.
npm run fast:demo
npm run demo:status

# Phoenix integration checks
npm run phoenix:probe
# To create a fresh non-expired Meridian demo market:
# npm run demo:market
# To create a Phoenix-linked, two-sided-liquidity trading demo:
# npm run trade:demo
# To create and link a Phoenix Yes/USDC market for an existing Meridian market:
# MERIDIAN_MARKET=<market_account> npm run phoenix:create
# To mint YES inventory and place a tiny ask on a linked Phoenix book:
# MERIDIAN_MARKET=<market_account> npm run phoenix:smoke
# To link an already-created Phoenix market:
# MERIDIAN_MARKET=<market_account> PHOENIX_MARKET=<phoenix_market> npm run phoenix:link
# To exercise permissionless Pyth settlement on a market created with a real feed:
# DEMO_MARKET_TICKER=META DEMO_MARKET_EXPIRY_SECS=20 npm run demo:market
# MERIDIAN_MARKET=<market_account> npm run pyth:settle

# Automation one-shot runs:
npm run create:markets
# After 9:30am ET this command skips by default. For an intentional
# after-open rerun, use MORNING_ALLOW_AFTER_OPEN=true npm run create:markets.
SETTLEMENT_DRY_RUN=true SETTLEMENT_MAX_RETRIES=1 npm run settle:markets
SETTLEMENT_MAX_RETRIES=1 npm run settle:markets

# 5. Frontend
npm run dev --workspace=app
# → http://localhost:3000
```

## Core concepts

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design. In short:

- **Contract:** a pair of complementary SPL tokens (Yes, No) tied to one stock/strike/day
- **Invariant:** Yes payout + No payout = $1.00 USDC, always, enforced on-chain
- **One book, two perspectives:** each strike has a single Phoenix market (Yes vs USDC). Buying No = mint pair + sell Yes. Selling No = buy Yes. The frontend abstracts this.
- **Settlement:** at 4:05 PM ET, automation posts a Pyth price update and calls `settle_market` per contract. The on-chain program verifies the Pyth Receiver account owner, feed id, full verification, freshness, and confidence ratio. Devnet smoke demos may still use delayed `admin_settle` for deterministic testing.
- **Admin override:** if oracle is unreliable, admin can settle manually after a 1-hour delay.

For current devnet program IDs, example markets, and known-good smoke commands,
see [docs/DEVNET_DEMO.md](docs/DEVNET_DEMO.md).

## Status

- [x] Phase 1 — Repo scaffolding
- [x] Phase 2 — Anchor program: config, create_strike_market, mint_pair, redeem, pause
- [x] Phase 3 - Pyth integration + settle_market + admin_settle + redeem_yes/no
- [x] Phase 4 — Phoenix CLOB linkage + TS trade-router for all 4 paths
- [x] Phase 5 — Automation service (morning + settlement cron jobs, Pyth price-update posting wired)
- [x] Phase 6 — Next.js frontend (fallback mock data plus live Meridian market reads when IDL/env are present)
- [ ] Phase 7 - Devnet deployment + lifecycle demo (local fast demo works; devnet Phoenix create/link/order smoke works)
- [ ] Phase 8 — Polish: docs, CI, property-based tests

## License

MIT

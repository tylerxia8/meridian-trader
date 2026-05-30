# Meridian - Binary Stock Outcome Markets on Solana

A non-custodial Solana dApp for trading binary outcome contracts on the daily closing prices of MAG7 US equities: AAPL, MSFT, GOOGL, AMZN, NVDA, META, and TSLA. Each contract asks: "Will [STOCK] close at or above [PRICE] today?" YES pays $1 USDC if true; NO pays $1 USDC if false. Contracts expire same-day and settle from Pyth equity feeds. YES tokens trade against USDC on Phoenix CLOB, while the UI maps YES/NO actions onto one book.

**Status:** compile-clean frontend and automation, deployed devnet Meridian program, working lifecycle demo, Pyth settlement path, delayed admin fallback, Phoenix market creation/linking, two-sided Phoenix liquidity seeding, wallet portfolio/history views, and browser transaction builders for trade/redeem.

## Architecture

```text
Frontend (Next.js)
  - Markets, trade, portfolio, history, status
  - Wallet signs trade/redeem transactions
        |
        v
Meridian Anchor Program (Solana)
  - create_strike_market
  - mint_pair
  - settle_market / admin_settle
  - redeem_pair / redeem_yes / redeem_no
        ^
        |
Automation (Node)
  - morning market creation
  - settlement jobs
  - Pyth price updates

Phoenix CLOB
  - one YES/USDC book per linked strike
  - bid/ask liquidity gates browser trading

Pyth
  - equity price feeds for settlement
```

## Repo Layout

```text
programs/meridian/      Rust Anchor program
app/                    Next.js frontend
automation/             Node.js market creation and settlement service
scripts/                Deployment, demo, Phoenix, and lifecycle scripts
docs/                   Architecture, devnet notes, and risks
```

## Prerequisites

| Tool | Recommended | Verify |
|---|---:|---|
| Node.js | 20+ | `node --version` |
| Rust | 1.75+ | `rustc --version` |
| Solana CLI | 1.18+ | `solana --version` |
| Anchor CLI | 1.0.2 currently used | `anchor --version` |

WSL 2 + Ubuntu is strongly recommended on Windows. Avoid mixing a Windows-path checkout with a WSL-path checkout for Anchor/Solana work.

## WSL Setup

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

# Anchor via AVM
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.0.2
avm use 1.0.2
```

## First Build

```bash
npm install --ignore-scripts
anchor build
npm run lint
npm run typecheck
npm test --workspace=automation
npm run build --workspace=app
```

If `anchor build` reports a program ID mismatch, run `anchor keys sync` or deploy with the program keypair that matches the source.

## Devnet Quick Start

```bash
# One-time keypairs
mkdir -p keypairs
solana-keygen new -o ./keypairs/admin.json --no-bip39-passphrase
solana-keygen new -o ./keypairs/automation.json --no-bip39-passphrase
solana config set --url https://api.devnet.solana.com

# Copy and fill environment
cp .env.example .env
```

Required `.env` values include:

```bash
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
MERIDIAN_PROGRAM_ID=<deployed_program_id>
NEXT_PUBLIC_MERIDIAN_PROGRAM_ID=<deployed_program_id>
USDC_MINT=<devnet_usdc_mint>
ANCHOR_WALLET=./keypairs/admin.json
AUTOMATION_WALLET=./keypairs/automation.json
PYTH_FEED_META=<0x_feed_id>
```

Build and deploy:

```bash
anchor build
anchor program deploy target/deploy/meridian.so \
  --program-keypair target/deploy/meridian-keypair.json \
  --provider.cluster devnet
anchor keys list
```

Copy the `meridian` program ID into both `MERIDIAN_PROGRAM_ID` and `NEXT_PUBLIC_MERIDIAN_PROGRAM_ID`.

## Demo Commands

```bash
# Readiness and smoke lifecycle
npm run lifecycle:demo
npm run demo:status

# Create daily configured-feed markets
npm run create:markets

# Settlement inventory and settlement
SETTLEMENT_DRY_RUN=true SETTLEMENT_MAX_RETRIES=1 npm run settle:markets
SETTLEMENT_MAX_RETRIES=1 npm run settle:markets

# Phoenix checks
npm run phoenix:probe
npm run demo:market
MERIDIAN_MARKET=<market_account> npm run phoenix:create
MERIDIAN_MARKET=<market_account> npm run phoenix:smoke
MERIDIAN_MARKET=<market_account> PHOENIX_MARKET=<phoenix_market> npm run phoenix:link

# One-command tradable demo:
# creates a Meridian market, links a Phoenix book, and seeds bid/ask liquidity.
npm run trade:demo

# Permissionless Pyth settlement smoke for a short-lived real-feed market
DEMO_MARKET_TICKER=META DEMO_MARKET_EXPIRY_SECS=20 npm run demo:market
MERIDIAN_MARKET=<market_account> npm run pyth:settle
```

Notes:

- `create:markets` skips after 9:30am ET unless `MORNING_ALLOW_AFTER_OPEN=true` is set.
- `trade:demo` spends devnet SOL because it creates a Phoenix market and seeds liquidity.
- Browser trading requires an active Phoenix-linked market with live bid/ask liquidity. Empty books intentionally disable market-order buttons.
- The app can prepare a connected wallet's Phoenix seat through `/api/phoenix-seat`, using the configured devnet admin authority.

## Frontend

```bash
npm run dev --workspace=app
```

Open:

```text
http://localhost:3000/markets
http://localhost:3000/status
http://localhost:3000/trade/META
http://localhost:3000/portfolio
http://localhost:3000/history
```

Useful API endpoints:

```text
GET  /api/status
POST /api/trade
POST /api/redeem
POST /api/phoenix-seat
```

## Core Concepts

- **Complementary tokens:** each market mints YES and NO SPL tokens.
- **$1 invariant:** one matched YES/NO pair always redeems for $1 USDC before settlement.
- **One book, two perspectives:** Phoenix lists YES/USDC. Buying NO is implemented as mint pair plus sell YES; selling NO is buy YES plus redeem matched pair.
- **Settlement:** automation posts a Pyth price update and calls `settle_market`. The program verifies owner, feed ID, full verification, freshness, and confidence ratio.
- **Admin fallback:** delayed `admin_settle` remains available for demos and oracle outages.
- **Liquidity gating:** the UI and API only allow market-order actions when the required Phoenix side has live depth.

For current devnet program IDs, known-good markets, and demo notes, see [docs/DEVNET_DEMO.md](docs/DEVNET_DEMO.md).

## Status

- [x] Phase 1 - Repo scaffolding
- [x] Phase 2 - Anchor program: config, create market, mint, redeem, pause
- [x] Phase 3 - Pyth settlement, delayed admin fallback, winning-token redemption
- [x] Phase 4 - Phoenix CLOB linkage and trade-router paths
- [x] Phase 5 - Automation service for morning creation and settlement
- [x] Phase 6 - Next.js frontend with live market, portfolio, history, and status views
- [x] Phase 7 - Devnet deployment and lifecycle/Phoenix smoke flows
- [ ] Phase 8 - Product polish, monitoring, richer test coverage, and production hardening

## License

MIT

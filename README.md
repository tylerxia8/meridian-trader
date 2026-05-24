# Meridian — Binary Stock Outcome Markets on Solana

A non-custodial Solana dApp for trading binary outcome contracts on the daily closing prices of MAG7 US equities (AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA). Each contract asks *"Will [STOCK] close at or above [PRICE] today?"* and pays $1 USDC if yes, $0 if no. Contracts expire same-day (0DTE) and settle at 4:00 PM ET via the Pyth oracle. Yes and No tokens trade on Phoenix CLOB.

**Status:** scaffolding (Phase 1).

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

This project requires the Solana toolchain. On Windows, install via WSL (recommended) or directly:

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | https://nodejs.org |
| Rust | ≥ 1.75 | https://rustup.rs |
| Solana CLI | ≥ 1.18 | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor | ≥ 0.30 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install latest && avm use latest` |

Once installed, verify:

```bash
node --version
rustc --version
solana --version
anchor --version
```

## Quick start (devnet)

```bash
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.example .env
# fill in PYTH_FEED_* and (after deploy) MERIDIAN_PROGRAM_ID

# 3. Generate keypairs
solana-keygen new -o ./keypairs/admin.json --no-bip39-passphrase
solana-keygen new -o ./keypairs/automation.json --no-bip39-passphrase
solana airdrop 2 $(solana address -k ./keypairs/admin.json) --url devnet

# 4. Build and deploy the program
anchor build
anchor deploy --provider.cluster devnet

# 5. Run the end-to-end lifecycle demo (create → mint → trade → settle → redeem)
npm run lifecycle:demo

# 6. Frontend
npm run dev --workspace=app
# → http://localhost:3000
```

## Core concepts

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design. In short:

- **Contract:** a pair of complementary SPL tokens (Yes, No) tied to one stock/strike/day
- **Invariant:** Yes payout + No payout = $1.00 USDC, always, enforced on-chain
- **One book, two perspectives:** each strike has a single Phoenix market (Yes vs USDC). Buying No = mint pair + sell Yes. Selling No = buy Yes. The frontend abstracts this.
- **Settlement:** at 4:05 PM ET, automation reads Pyth's close price, calls `settle_market` per contract. Outcomes are immutable.
- **Admin override:** if oracle is unreliable, admin can settle manually after a 1-hour delay.

## Status

- [x] Phase 1 — Repo scaffolding
- [x] Phase 2 — Anchor program: config, create_strike_market, mint_pair, redeem, pause
- [x] Phase 3 — Pyth integration + settle_market + admin_settle + redeem_yes/no
- [x] Phase 4 — Phoenix CLOB linkage + TS trade-router for all 4 paths
- [x] Phase 5 — Automation service (morning + settlement cron jobs)
- [x] Phase 6 — Next.js frontend skeleton (Landing, Markets, Trade, Portfolio, History)
- [ ] Phase 7 — Devnet deployment + lifecycle demo
- [ ] Phase 8 — Polish: docs, CI, property-based tests

## License

MIT

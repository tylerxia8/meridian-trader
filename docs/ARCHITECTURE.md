# Architecture

This document captures the major design decisions, alternatives considered, and known trade-offs. It is the canonical reference for *why* the system looks the way it does.

## Goals

1. **Correctness over features.** The Yes + No = $1.00 USDC invariant must never break.
2. **Liveness.** Markets exist before US market open, settle within 10 minutes of close.
3. **Non-custodial.** Users hold their own keys; the program holds only collateral.
4. **Transparency.** All state changes (mint, trade, settle, redeem) are on-chain and auditable.

## High-level architecture

Three components, one repo:

- **Anchor program** (`programs/meridian/`) — mint pairs, hold collateral, settle outcomes, pay redemptions. The only authority over user funds is the program itself.
- **Automation service** (`automation/`) — Node.js cron. Creates markets each morning, calls settle after close. Holds *no* user funds; only signs admin-permissioned instructions.
- **Frontend** (`app/`) — Next.js. Connects user wallet, reads markets/order books from chain, builds and submits transactions.

External dependencies:

- **Pyth Network** — equity price oracle. Provides previous close (off-chain API, for strike calc) and intraday/close prices (on-chain Pull oracle, for settlement).
- **Phoenix** — on-chain CLOB. One Phoenix market per strike: Yes token (base) vs USDC (quote).

## Key design decisions

### 1. Solana + Anchor

**Choice:** Rust + Anchor framework on Solana (devnet for submission, mainnet-beta as bonus).

**Why:** PRD requires sub-second finality for live order book trading. Solana hits this; Phoenix already exists as a high-quality on-chain CLOB. EVM L2s would add latency and lack a direct equivalent to Phoenix.

**Alternatives considered:**
- *Arbitrum/Base + Solidity:* Acceptable per PRD, but no first-class on-chain CLOB at the latency we need. Would push more trading off-chain or require a custom order book.
- *HyperLiquid:* Doesn't natively support custom instruments like this.

### 2. Phoenix CLOB (not custom)

**Choice:** Integrate Phoenix rather than build a CLOB inside the program.

**Why:** The interesting on-chain logic is the mint/settle/redeem state machine and the $1.00 invariant. Phoenix is battle-tested, fee-free at the protocol level, and has TypeScript SDK support. Time saved goes into invariant testing, oracle hardening, and the lifecycle demo.

**Trade-off:** One Phoenix market per strike means ~30-40 markets per day across MAG7 — non-trivial setup cost. We'll batch creation in the morning cron and reuse market addresses where possible.

**On-chain glue:** The Meridian `Market` account stores the linked `phoenix_market: Pubkey`. Admin calls `link_phoenix_market` after creating the Phoenix market off-chain via the SDK. Meridian does *not* CPI into Phoenix — the four trade paths are built as multi-instruction transactions on the client (atomic at the Solana tx level).

**Phoenix devnet:** Phoenix is primarily deployed on mainnet-beta. For the devnet lifecycle demo, we either (a) clone the Phoenix program into the local validator using `Anchor.toml`'s `test.validator.clone`, or (b) deploy a local Phoenix instance. The lifecycle script documents both paths.

**The four trade paths** (all single-tx, atomic, one wallet approval):
- **Buy Yes** → Phoenix `Buy` (taker against asks)
- **Sell Yes** → Phoenix `Sell` (taker against bids)
- **Buy No** → `[meridian.mint_pair, Phoenix Sell-Yes IOC]` in one tx. User deposits $1 per pair, sells Yes at market, keeps No.
- **Sell No** → Phoenix `Buy Yes` (user already has No; new Yes + existing No = $1 redeemable pair). Optionally append `meridian.redeem_pair` to net out to USDC in the same tx.

### 3. Pyth oracle

**Choice:** Pyth Network's pull oracle (`pyth-solana-receiver-sdk`) — *intended* approach. **Currently stubbed.**

**Why Pyth was chosen:** Pyth provides MAG7 equity feeds with explicit confidence intervals (required for the PRD's confidence check). Pull model gives control over when the price is posted on-chain — important for the precise 4 pm ET settlement window.

**Why it's stubbed today:** `pyth-solana-receiver-sdk v1.2.0` has an internal borsh-version mismatch (its `PriceFeedMessage` uses borsh 0.10.x while its `#[account]` derive on `PriceUpdateV2` expects borsh 1.x, dragged in by Anchor 1.0). The crate fails to compile. Until Pyth ships a version compatible with Anchor 1.0, `settle_market` returns an error and **`admin_settle` is the only settlement path**. `admin_settle` is functionally complete — it validates expiry + override delay and uses the same `finalize_settlement` outcome logic — so this is a strictly-temporary regression of the *permissionless* settlement guarantee, not a correctness regression.

**When to restore:** track Pyth's GitHub for a release that pins borsh 1.x across both `pythnet-sdk` and `pyth-solana-receiver-sdk`. Restore is a one-line Cargo.toml change plus uncomment the `get_price_no_older_than` call in `settle_market.rs`.

**Alternatives if Pyth stays broken:** Switchboard (less mature equity confidence intervals), Chainlink (thinner Solana equity coverage), or hand-roll a Pyth account parser using the wire format spec from Pyth docs.

### 4. One book, two perspectives

**Choice:** Each strike has a single Phoenix market (Yes/USDC). The "No" side of the book is the inverse of the Yes side, presented by the frontend.

**Why:** Yes + No = $1.00 makes a separate No order book redundant and would fragment liquidity. The frontend translates the four user actions (Buy/Sell Yes/No) into the right combination of mint+sell or buy on the single book.

**Implementation note:** "Buy No" is an atomic instruction in our program that mints a pair (taking $1 USDC) and posts/sells the Yes side. User keeps the No token. One wallet approval, not two.

### 5. SPL token mints per contract

**Choice:** Each strike gets two SPL mints (Yes, No), one collateral vault (USDC), one Phoenix market.

**Why:** Standard tokens compose with every Solana wallet, explorer, and DEX automatically. Users see Yes/No balances natively in Phantom/Solflare.

**Trade-off:** Rent cost per strike. With ~7 stocks × ~5 strikes/stock = 35 strikes/day, this is manageable on devnet and acceptable on mainnet.

### 6. Settlement: pull oracle + automation + admin override

**Choice:** Three-layer defense.
1. *Automation* calls `settle_market` at 4:05 PM ET. Reads Pyth price on-chain with staleness + confidence checks. Retries every 30s for up to 15min.
2. If still failing, admin can call `admin_settle` with a manual price after a **1-hour delay** since market close. Time-delay enforced on-chain.
3. Pause/unpause exists for emergencies but does not bypass settlement logic.

**Why:** Real-world oracles fail. The retry window plus delayed admin override means we never settle with bad data and never freeze user funds permanently.

## Invariants (enforced on-chain)

| # | Invariant | Where enforced |
|---|---|---|
| 1 | `vault.balance == $1.00 × total_pairs_outstanding` | `mint_pair` / `redeem` math |
| 2 | `Yes_payout + No_payout == $1.00` at settlement | `settle_market` outcome write |
| 3 | Yes/No tokens minted only via `mint_pair` | Mint authority = vault PDA |
| 4 | Yes/No tokens burned only via `redeem` | Token program account constraints |
| 5 | Settlement outcome is immutable once written | `Market.settled` flag check |
| 6 | Admin override blocked until `market_close + 1h` | Timestamp check in `admin_settle` |

## Settlement logic (deterministic)

```
if oracle_price_usd_cents >= strike_price_usd_cents:
    yes_payout = 1.00 USDC
    no_payout  = 0.00 USDC
else:
    yes_payout = 0.00 USDC
    no_payout  = 1.00 USDC
```

At-strike (oracle == strike) → Yes wins, per PRD's "at or above" rule.

## Strike selection

Each morning the automation service:

1. Reads previous close from Pyth for each ticker.
2. Computes strikes at ±3%, ±6%, ±9% of prev close.
3. Rounds each to the nearest $10.
4. Deduplicates (low-priced stocks may collapse multiple percentages to the same strike).
5. Calls `create_strike_market` once per resulting strike.

## Position constraints

A wallet holding No tokens for strike S cannot "Buy Yes" for S without first selling its No position. Enforced on the frontend by reading user token balances and gating the trade panel. The on-chain program does *not* enforce this (it's a UX constraint, not a safety constraint — holding both tokens is equivalent to holding $1 of redeemable USDC, which is fine).

## Risks and limitations

- **No regulatory or compliance claims.** Binary outcome markets may be regulated in some jurisdictions; this is research-grade software, not a product.
- **Oracle dependency.** If Pyth is wrong, settlement is wrong. The confidence check mitigates this but doesn't eliminate it.
- **Phoenix dependency.** If Phoenix has downtime or migrates, the trading layer is affected. The Anchor program (mint/settle/redeem) is independent and would still let users exit existing positions.
- **No fee model in v1.** The vault holds exactly $1 per pair. Adding fees later requires a separate fee account and changes to the mint math.
- **Devnet USDC is fake.** Lifecycle demo uses devnet USDC; mainnet deployment would need extra integration work for production USDC.

## Future work (out of scope for v1)

- Cross-strike spread orders ("buy >$680 + sell >$700" as a single transaction)
- More underlyings beyond MAG7
- Position netting across strikes for the same ticker
- Off-chain order book with on-chain settlement (hybrid model) if Phoenix latency becomes a bottleneck

# Phase 8 Plan

This project is past the prototype-build stage. The current baseline has:

- A deployed devnet Meridian program.
- A compiled Anchor program and generated IDL.
- Manual Pyth Receiver `PriceUpdateV2` parsing in `settle_market`.
- Phoenix market creation/linking/smoke scripts.
- Automation jobs for market creation and settlement.
- Frontend market, trade, status, portfolio, and history flows.
- Browser transaction builders for trade and redemption.

## Latest Validation Snapshot

Validated on the Windows checkout:

- `npm test --workspace=automation` - 10 passed.
- `npm test --workspace=app` - 8 passed.
- `npm run typecheck --workspace=automation` - passed.
- `npm run typecheck --workspace=app` - passed.
- `npm run lint --workspace=app` - passed.
- `npm run build --workspace=app` - passed.
- `npm audit fix` applied one non-breaking lockfile update (`protobufjs`).

Validated in WSL:

- `CARGO_BUILD_JOBS=2 anchor build --ignore-keys` - passed.
- `cargo test --lib --target x86_64-unknown-linux-gnu` - 6 passed.

Known validation caveat:

- `anchor test` integration tests need a local test wallet and validator/deploy-key setup. The source is pinned to the deployed devnet program id, while a fresh local `target/deploy/meridian-keypair.json` usually differs. Use a dedicated local-test branch or temporary `anchor keys sync` when running local integration tests.

## Remaining Work

### 1. Integration Test Harness

Goal: make `anchor test` reproducible from a fresh WSL checkout.

Current workflow:

```bash
npm run test:program:local
```

This calls `scripts/run-local-anchor-test.sh`, which:

- Generates `keypairs/admin.json` if missing.
- Generates `target/deploy/meridian-keypair.json` if missing.
- Temporarily stamps the local deploy key's program id into `Anchor.toml`
  and `declare_id!` so local test ids match.
- Runs `anchor test --provider.cluster localnet --validator legacy` against
  `solana-test-validator`, avoiding devnet deploys, RPC rate limits, and an
  extra Surfpool install.
- The local validator config intentionally avoids devnet clones. The Anchor
  integration tests create their own test USDC mint, so cloning devnet USDC
  only adds an RPC failure mode.
- Restores the committed devnet program id in `Anchor.toml` and `lib.rs` on exit.

Remaining work:

- Run this command in WSL after the local Solana toolchain is loaded. Use Node 24+ because current Pyth packages declare Node 22/24 engine requirements.
- If it exposes test failures, fix the tests/program behavior rather than changing the devnet program id.
- Keep the deployed devnet program id stable for demos.

### 2. Pyth Parser Hardening

Goal: increase confidence in the manual `PriceUpdateV2` parser.

- Add fixture tests from real posted Pyth Receiver accounts.
- Test invalid owner/discriminator/verification-level cases.
- Test stale publish time and wide confidence rejection.
- Keep the parser isolated and well-commented so it can later be replaced by a compatible Pyth SDK type.

### 3. Invariant and Property Tests

Goal: prove the `$1` collateral invariant across more state transitions.

- Randomized mint/redeem sequences.
- Settlement followed by winning-token redemption.
- Matched-pair redemption after settlement.
- Double-settlement rejection.
- Wrong-side redemption rejection.
- Pause/unpause gating under active positions.

### 4. Demo Reliability

Goal: one clean walkthrough from fresh checkout to browser trade.

- Re-run and document:
  - `npm run lifecycle:demo`
  - `npm run trade:demo`
  - `npm run tradable:status`
  - `npm run pyth:settle`
  - browser `/markets`, `/trade/META`, `/portfolio`, `/history`
- Keep known-good devnet market and Phoenix addresses current in `docs/DEVNET_DEMO.md`.
- Add recovery instructions for empty Phoenix books, stale Pyth prices, and wallet USDC/SOL shortages.

### 5. Frontend Product Polish

Goal: make the app feel dependable during a live demo.

- Clearly label fallback/mock strikes when live devnet reads fail.
- Tighten empty states for no active markets, no Phoenix liquidity, and no redeemable positions.
- Make transaction progress states consistent across trade, Phoenix seat prep, and redemption.
- Add final visual QA across desktop and mobile.

### 6. Dependency and Security Review

Goal: document and reduce known audit risk without destabilizing Solana dependencies.

- Remaining audit issues are mostly transitive Solana/wallet/Phoenix dependencies with no clean non-breaking fix.
- Do not run `npm audit fix --force` blindly; it attempts breaking changes such as downgrading major packages.
- Track upstream fixes for:
  - `@solana/web3.js`
  - wallet adapter packages
  - Phoenix SDK dependencies
  - Next/PostCSS advisory resolution

### 7. Operations Hardening

Goal: make automation safe to run without babysitting.

- SOL balance checks and alerts for admin/automation wallets.
- Cron deployment notes.
- Settlement runbook.
- Admin override policy.
- Multisig recommendation before any non-devnet deployment.

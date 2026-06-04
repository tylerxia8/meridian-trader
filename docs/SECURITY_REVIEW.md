# Security Review Checklist

This checklist is the pre-mainnet review surface for Meridian. Treat every item as blocking until it has either a linked test, a linked code reference, or an explicit risk acceptance.

## Program Authority

- Verify the upgrade authority is held by the intended deployer or governance key.
- Verify `Config.admin` is the only authority for `create_strike_market`, `update_config`, `pause`, `unpause`, `link_phoenix_market`, and delayed `admin_settle`.
- Verify admin fallback cannot settle before `market.expiry_ts + admin_override_delay_secs`.
- Decide and document the production policy for pausing, admin override, and upgrade authority rotation.

## PDA And Account Constraints

- Confirm every market PDA seed includes `ticker`, `strike_price_usd_cents`, and `expiry_ts`.
- Confirm YES mint, NO mint, and vault addresses are derived from the market PDA and validated on every instruction that moves assets.
- Confirm user token accounts are constrained to the expected mint and owner.
- Confirm Phoenix market linking cannot be overwritten by a non-admin.

## Asset Conservation

- Matched YES/NO minting must increase vault USDC, YES supply, and NO supply by the same atom amount.
- Matched YES/NO redemption must decrease vault USDC, YES supply, and NO supply by the same atom amount.
- Winning-token redemption must burn only the winning side and pay exactly one USDC atom per token atom.
- Losing-token redemption must always fail after settlement.
- No instruction should allow withdrawing vault USDC without burning the corresponding claim token.

## Settlement And Oracle Safety

- `settle_market` must reject a price update owned by the wrong program.
- `settle_market` must reject a price update for the wrong feed id.
- `settle_market` must reject stale prices using `Config.max_staleness_secs`.
- `settle_market` must reject overly wide confidence intervals using `Config.max_conf_ratio_bps`.
- The exact strike rule is intentional: price at or above strike resolves to YES.
- Settlement must be one-way: once `Market.outcome` is not `Unsettled`, no settlement path can mutate it.

## Trading And Phoenix Integration

- Browser and API trade paths must reject inactive, expired, settled, unlinked, or illiquid markets.
- `buyNo` must preserve the economic route: mint pair, sell YES.
- `sellNo` must preserve the economic route: buy YES, redeem matched pair.
- Phoenix seat preparation must be idempotent and must not require custody of user funds.
- Off-chain price and liquidity displays are advisory; on-chain settlement remains the source of outcome truth.

## Operational Controls

- Run `npm run test:program:local` from WSL before every deploy.
- Run `npm run lint`, `npm run typecheck`, app tests, and automation tests before every deploy.
- Run `scripts/deploy-devnet-smoke.sh` for devnet deploys and save the output with the release notes.
- Run `npm run demo:status` after deploy and before public demos.
- Run settlement jobs first in dry-run mode after any automation change.

## Known Residual Risks

- Devnet USDC is not real USDC and should never be represented as such.
- Pyth equity feeds have market-hours semantics; stale or unavailable prices are expected outside supported windows.
- Phoenix devnet liquidity is thin and demo-seeded liquidity can disappear.
- Admin fallback is useful for demos but is a trust assumption. Production must either remove it, heavily delay it, or place it behind governance/multisig.

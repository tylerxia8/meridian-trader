# Risks and Limitations

Per PRD requirement: short risks/limitations note, no regulatory or compliance claims.

## Known scope deviation (v1)

`settle_market` (the permissionless Pyth-oracle settlement path) is currently stubbed because `pyth-solana-receiver-sdk 1.2.0` has an internal borsh-version conflict that prevents compilation under Anchor 1.0. **`admin_settle` is the only working settlement path until Pyth ships a compatible SDK.** Outcome correctness is unaffected — admin_settle applies the same `finalize_settlement` rule — but settlement requires the admin signer rather than being permissionless. See [ARCHITECTURE.md § Pyth oracle](ARCHITECTURE.md) for restore steps.

## Technical risks

| Risk | Mitigation | Residual |
|---|---|---|
| Oracle returns stale or wide-confidence price at 4pm ET | Staleness threshold (5min default), confidence-ratio check (0.5% default), 15min retry window | If Pyth is down for >15min, requires admin override with 1h delay |
| Admin keypair compromise | Admin powers limited to: add strikes, pause/unpause, override-settle (with time delay). Cannot drain vault. | Admin can mis-settle after 1h delay → users could redeem incorrectly. Mitigation: multisig admin in mainnet deployment. |
| Phoenix downtime during trading hours | Trading pauses; mint/redeem unaffected | Users can still close positions by redeeming a Yes+No pair for $1 |
| Solana network congestion | Helius/Triton RPC for higher throughput; retry with backoff | At-edge: settlement could miss the 10min window |
| At-strike ambiguity (oracle exactly == strike) | PRD specifies "at or above" → Yes wins | Deterministic |
| Rounding errors with low-priced stocks | Strike dedup after $10 rounding | AAPL near $230 may collapse ±3% and ±6% to same strike (intended) |

## Operational risks

- **Automation wallet runs out of SOL** → markets don't get created/settled. Mitigation: balance monitoring + alerting.
- **Code bug in `mint_pair` or `redeem`** → invariant violation. Mitigation: exhaustive unit + property-based tests for the $1 invariant.
- **NYSE holidays / early closes** → strike timing off. Mitigation: NYSE calendar in automation; settlement uses oracle timestamp, not wall-clock.

## Known limitations (v1)

- 7 tickers (MAG7) only.
- 6 strikes per ticker per day (3 above, 3 below at ±3/6/9%), deduplicated.
- Same-day expiry only (0DTE).
- USDC-only collateral.
- No portfolio margining; each contract collateralized 1:1.
- No fees (vault must equal $1 × pairs outstanding exactly).
- English UI only.

## Not claimed

This software makes no claims about regulatory compliance in any jurisdiction. It is provided for research, development, and educational use on test networks. Do not deploy with real funds without independent legal review.

# Risks and Limitations

Per PRD requirement: short risks/limitations note, no regulatory or compliance claims.

## Known scope note (v1)

`settle_market` is implemented without a direct Rust dependency on `pyth-solana-receiver-sdk` because that crate currently pulls a different Anchor version than this program. The program manually parses the posted Pyth Receiver `PriceUpdateV2` layout and verifies owner, full verification, feed id, staleness, and confidence ratio. This keeps settlement permissionless while avoiding an Anchor dependency conflict.

## Technical risks

| Risk | Mitigation | Residual |
|---|---|---|
| Oracle returns stale or wide-confidence price at 4pm ET | Staleness threshold (5min default), confidence-ratio check (0.5% default), 15min retry window | If Pyth is down for >15min, requires admin override with 1h delay |
| Admin keypair compromise | Admin powers limited to: add strikes, pause/unpause, override-settle (with time delay). Cannot drain vault. | Admin can mis-settle after 1h delay; mitigation is multisig admin before any mainnet deployment |
| Phoenix downtime during trading hours | Trading pauses; mint/redeem unaffected | Users can still close positions by redeeming a Yes+No pair for $1 |
| Solana network congestion | Helius/Triton RPC for higher throughput; retry with backoff | Settlement could miss the 10min target window |
| At-strike ambiguity (oracle exactly == strike) | PRD specifies "at or above"; Yes wins | Deterministic |
| Rounding errors with low-priced stocks | Strike dedup after $10 rounding | AAPL near $230 may collapse +/-3% and +/-6% to the same strike |

## Operational risks

- Automation wallet runs out of SOL: markets do not get created or settled. Mitigation: balance monitoring and alerts.
- Code bug in `mint_pair` or `redeem`: invariant violation. Mitigation: exhaustive unit and property tests for the $1 invariant.
- NYSE holidays or early closes: strike timing can be off. Mitigation: NYSE calendar in automation; settlement uses oracle timestamp, not wall-clock alone.

## Known limitations (v1)

- 7 tickers (MAG7) only.
- 6 strikes per ticker per day (3 above, 3 below at +/-3/6/9%), deduplicated.
- Same-day expiry only (0DTE).
- USDC-only collateral.
- No portfolio margining; each contract collateralized 1:1.
- No fees; vault must equal $1 times pairs outstanding exactly.
- English UI only.

## Not claimed

This software makes no claims about regulatory compliance in any jurisdiction. It is provided for research, development, and educational use on test networks. Do not deploy with real funds without independent legal review.

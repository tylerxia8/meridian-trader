# Devnet Demo Notes

This document records the current devnet deployment and known-good smoke paths.
It is intentionally operational: use it when preparing a walkthrough or
debugging a fresh checkout.

## Deployment

- Meridian program: `6SaMPmMDFZD6pg4NwK13Cph6YSSiZQwzBsbhrroRUJdy`
- Admin wallet: `BVRkWNKfL6PvwP74p8pgQSorcraTRNhwVR3URuQtYLAt`
- Automation wallet: `49R5sVhEDQY8oQRDzRaTFqqsXeMyL94KuG9dMAe74YTf`
- Cluster: `devnet`
- RPC: `https://api.devnet.solana.com`

Required `.env` values:

```bash
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
MERIDIAN_PROGRAM_ID=6SaMPmMDFZD6pg4NwK13Cph6YSSiZQwzBsbhrroRUJdy
NEXT_PUBLIC_MERIDIAN_PROGRAM_ID=6SaMPmMDFZD6pg4NwK13Cph6YSSiZQwzBsbhrroRUJdy
```

## Verification Commands

Run these from WSL in the project root:

```bash
npm run lifecycle:demo
npm run create:markets
SETTLEMENT_MAX_RETRIES=1 npm run settle:markets
npm run dev --workspace=app
```

Notes:

- `npm run create:markets` skips after 9:30am ET unless
  `MORNING_ALLOW_AFTER_OPEN=true` is set.
- The settlement job skips old fake-feed demo markets by design.
- If settlement is run well after the close-price freshness window, real-feed
  markets can report `OracleStale`. In that case the job logs that delayed
  `admin_settle` may be needed after the configured override delay.
- `lifecycle:demo` uses the one-hour admin override delay unless you
  temporarily update deployed config with `ADMIN_OVERRIDE_DELAY_SECS=1 npm run config:update`.

## Known Working Examples

Permissionless Pyth settlement:

- Meridian market: `GhoyZ5echqzxK5SG973im6PF5gsFuEr4mGtDS4iLcJ17`
- Outcome: `NoWins`
- Settlement price: `63192` cents
- Pyth `PriceUpdateV2`: `2vEQbsuGFZgJUj2zwgWz3vxoXTsMXffZPAHjr26QoaEs`

Phoenix-linked real-feed market:

- Meridian market: `9rAPd1bP5vQeVApEMuSvAKALeWx6WpX8kjZ8H8fNE5sb`
- Phoenix market: `6CLZqbGihQaqUuNrNbbS5TWA3SM9ag24c7WfTjnnDbfy`
- Smoke order transaction:
  `4yhSZBKtiYAwxCmavhy1sVc7JpzCheRKjcFcwEWMaAaDfz4aafrgtmA23hR6y2LF5CVA8KAADUMkweCH8Yajxf7u`

Phoenix-linked fake-feed market, kept only for integration debugging:

- Meridian market: `B1jFEXoSmUkNDLWKo4RLgapcihE3hbYivrz1siQSEaLw`
- Phoenix market: `9DdGPbFA8wxyzduRwbrKFMNVLRBQndXdGs52mXi9LDLy`

## Frontend

The frontend reads live Meridian market accounts when the IDL and env are
available. It falls back gracefully if devnet is slow or the generated IDL is
missing.

```bash
npm run dev --workspace=app
```

Open:

```text
http://localhost:3000/markets
http://localhost:3000/trade/META
```

The trade screen currently shows live markets, linked Phoenix status, and the
connected wallet's YES/NO token balances. Final Phoenix order submission from
the browser is the remaining major UX implementation step.

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CLUSTER="${SOLANA_CLUSTER:-devnet}"
RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-./keypairs/admin.json}"
PROGRAM_KEYPAIR="${MERIDIAN_PROGRAM_KEYPAIR:-target/deploy/meridian-keypair.json}"

if [[ "$CLUSTER" != "devnet" ]]; then
  echo "[deploy:devnet] Refusing to deploy with SOLANA_CLUSTER=$CLUSTER; set SOLANA_CLUSTER=devnet." >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[deploy:devnet] Missing required command: $1" >&2
    exit 1
  fi
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "[deploy:devnet] Missing required file: $1" >&2
    exit 1
  fi
}

require_cmd anchor
require_cmd solana
require_cmd npm
require_file "$WALLET"

echo "[deploy:devnet] RPC:    $RPC_URL"
echo "[deploy:devnet] Wallet: $WALLET"

solana config set --url "$RPC_URL" --keypair "$WALLET" >/dev/null

if [[ ! -f "$PROGRAM_KEYPAIR" ]]; then
  mkdir -p "$(dirname "$PROGRAM_KEYPAIR")"
  solana-keygen new -o "$PROGRAM_KEYPAIR" --no-bip39-passphrase --force >/dev/null
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
export MERIDIAN_PROGRAM_ID="${MERIDIAN_PROGRAM_ID:-$PROGRAM_ID}"
export NEXT_PUBLIC_MERIDIAN_PROGRAM_ID="${NEXT_PUBLIC_MERIDIAN_PROGRAM_ID:-$PROGRAM_ID}"
export SOLANA_RPC_URL="$RPC_URL"
export NEXT_PUBLIC_SOLANA_RPC_URL="${NEXT_PUBLIC_SOLANA_RPC_URL:-$RPC_URL}"
export ANCHOR_WALLET="$WALLET"

echo "[deploy:devnet] Program: $PROGRAM_ID"
echo "[deploy:devnet] Building program"
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" anchor build

echo "[deploy:devnet] Deploying program"
anchor program deploy target/deploy/meridian.so \
  --program-keypair "$PROGRAM_KEYPAIR" \
  --provider.cluster devnet \
  --provider.wallet "$WALLET"

echo "[deploy:devnet] Verifying generated artifacts"
test -s target/deploy/meridian.so
test -s target/idl/meridian.json
anchor keys list

if [[ "${MERIDIAN_SKIP_STATUS:-false}" != "true" ]]; then
  echo "[deploy:devnet] Running status smoke"
  npm run demo:status
fi

echo "[deploy:devnet] Done"

#!/usr/bin/env bash
set -euo pipefail

# Run Anchor integration tests against a local validator without permanently
# replacing the committed devnet program id.
#
# Why this exists:
# - The repo source is pinned to the deployed devnet program id.
# - Local `anchor test` wants `declare_id!`, Anchor.toml, and
#   target/deploy/meridian-keypair.json to agree.
# - `anchor keys sync` solves that, but it rewrites source files.
#
# This script performs that rewrite only for the duration of the test run and
# restores the committed devnet ids on exit.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! git diff --quiet -- Anchor.toml programs/meridian/src/lib.rs; then
  echo "[local-test] Anchor.toml or programs/meridian/src/lib.rs has uncommitted changes."
  echo "[local-test] Commit/stash them before running this script so restore is safe."
  exit 1
fi

if ! command -v anchor >/dev/null 2>&1; then
  echo "[local-test] anchor CLI not found on PATH."
  echo "[local-test] In WSL, load your toolchain first, e.g.:"
  echo '  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20'
  echo "  avm use 1.0.2"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[local-test] node not found on PATH."
  echo "[local-test] In WSL, run:"
  echo '  export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20'
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "[local-test] node_modules missing; running npm install --ignore-scripts"
  npm install --ignore-scripts
fi

mkdir -p keypairs target/deploy

if [[ ! -f keypairs/admin.json ]]; then
  echo "[local-test] creating keypairs/admin.json"
  solana-keygen new -o keypairs/admin.json --no-bip39-passphrase --force >/dev/null
fi

if [[ ! -f target/deploy/meridian-keypair.json ]]; then
  echo "[local-test] creating target/deploy/meridian-keypair.json"
  solana-keygen new -o target/deploy/meridian-keypair.json --no-bip39-passphrase --force >/dev/null
fi

anchor_toml_backup="$(mktemp)"
lib_rs_backup="$(mktemp)"
cp Anchor.toml "$anchor_toml_backup"
cp programs/meridian/src/lib.rs "$lib_rs_backup"

restore() {
  cp "$anchor_toml_backup" Anchor.toml
  cp "$lib_rs_backup" programs/meridian/src/lib.rs
  rm -f "$anchor_toml_backup" "$lib_rs_backup"
}
trap restore EXIT

echo "[local-test] syncing source ids to local target/deploy keypair"
local_program_id="$(solana-keygen pubkey target/deploy/meridian-keypair.json)"
python3 - "$local_program_id" <<'PY'
import re
import sys
from pathlib import Path

program_id = sys.argv[1]

anchor_toml = Path("Anchor.toml")
text = anchor_toml.read_text()
text = re.sub(r'(meridian\s*=\s*")[^"]+(")', rf'\g<1>{program_id}\2', text)
anchor_toml.write_text(text)

lib_rs = Path("programs/meridian/src/lib.rs")
text = lib_rs.read_text()
text = re.sub(r'declare_id!\("[^"]+"\);', f'declare_id!("{program_id}");', text)
lib_rs.write_text(text)
PY
echo "[local-test] temporary local program id: ${local_program_id}"

echo "[local-test] running anchor test on local validator"
ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}" \
ANCHOR_WALLET="${ANCHOR_WALLET:-./keypairs/admin.json}" \
CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}" \
anchor test \
  --provider.cluster localnet \
  --provider.wallet "${ANCHOR_WALLET:-./keypairs/admin.json}" \
  --validator legacy

echo "[local-test] passed; restored committed devnet program id"

#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}"
cargo build --locked --release --target wasm32-unknown-unknown -p yieldfund-vault --features rhea
mkdir -p artifacts/rhea
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_vault.wasm" artifacts/rhea/yieldfund_rhea_vault.wasm
sha256sum artifacts/rhea/yieldfund_rhea_vault.wasm

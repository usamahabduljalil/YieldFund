#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}"
mkdir -p "$repo/artifacts"
cargo build --locked --release --target wasm32-unknown-unknown -p yieldfund-vault -p yieldfund-test-token -p yieldfund-strategy-simulator
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_vault.wasm" "$repo/artifacts/yieldfund_vault.wasm"
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_test_token.wasm" "$repo/artifacts/yieldfund_test_token.wasm"
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_strategy_simulator.wasm" "$repo/artifacts/yieldfund_strategy_simulator.wasm"
if [[ "${1:-}" == "--with-test-faults" ]]; then
  cargo build --locked --release --target wasm32-unknown-unknown -p yieldfund-vault --features test-faults
  cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_vault.wasm" "$repo/artifacts/yieldfund_vault_faults.wasm"
  cargo build --locked --release --target wasm32-unknown-unknown -p yieldfund-strategy-simulator --features simulation-controls
  cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/yieldfund_strategy_simulator.wasm" "$repo/artifacts/yieldfund_strategy_simulator_controls.wasm"
fi
sha256sum "$repo/artifacts/yieldfund_vault.wasm" "$repo/artifacts/yieldfund_test_token.wasm"

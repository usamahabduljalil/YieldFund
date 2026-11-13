#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
# Factory embeds only normal artifacts, never fault-injection templates.
bash scripts/build-contracts.sh
cargo build --locked --release --target wasm32-unknown-unknown -p yieldfund-campaign-factory
cp "${CARGO_TARGET_DIR:-$repo/target}/wasm32-unknown-unknown/release/yieldfund_campaign_factory.wasm" artifacts/yieldfund_campaign_factory.wasm
sha256sum artifacts/yieldfund_campaign_factory.wasm

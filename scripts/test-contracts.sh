#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$repo/target}"
# Reuse the isolated runtime prepared on Ubuntu 22.04, if present. Do not alter
# the host's loader, LD_LIBRARY_PATH, or installed system packages.
compat="$HOME/.cache/yieldfund-near"
if [[ -z "${NEAR_SANDBOX_BIN_PATH:-}" && -x "$compat/bin/near-sandbox-2.14.0" && -f "$compat/glibc-2.39/root/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" ]]; then
  export YIELDFUND_SANDBOX_BIN="$compat/bin/near-sandbox-2.14.0"
  export YIELDFUND_GLIBC_DIR="$compat/glibc-2.39/root"
  export NEAR_SANDBOX_BIN_PATH="$repo/scripts/sandbox-compat.sh"
fi
if [[ -n "${NEAR_SANDBOX_BIN_PATH:-}" ]]; then
  "$NEAR_SANDBOX_BIN_PATH" --version | grep -q 'release 2.14.0'
fi
bash scripts/build-contracts.sh --with-test-faults
bash scripts/build-factory.sh
bash scripts/prepare-dao-fixture.sh
cargo test --locked -p yieldfund-accounting -p yieldfund-vault -p yieldfund-test-token -p yieldfund-strategy-simulator -p yieldfund-campaign-factory --lib
cargo test --locked -p yieldfund-integration --test vault -- --nocapture

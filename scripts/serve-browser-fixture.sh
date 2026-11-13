#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
compat="$HOME/.cache/yieldfund-near"
if [[ -z "${NEAR_SANDBOX_BIN_PATH:-}" && -x "$compat/bin/near-sandbox-2.14.0" && -f "$compat/glibc-2.39/root/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2" ]]; then
  export YIELDFUND_SANDBOX_BIN="$compat/bin/near-sandbox-2.14.0"
  export YIELDFUND_GLIBC_DIR="$compat/glibc-2.39/root"
  export NEAR_SANDBOX_BIN_PATH="$repo/scripts/sandbox-compat.sh"
fi
if [[ -f artifacts/stop-browser-fixture ]]; then
  echo 'Remove artifacts/stop-browser-fixture before starting a new local fixture.' >&2
  exit 1
fi
cargo test --locked -p yieldfund-integration --test vault browser_fixture::serve_browser_fixture -- --ignored --nocapture

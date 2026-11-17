#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
upstream="$repo/artifacts/integration-sources/rhea-lending"
revision=2110c7047f2d72a9189abcbaad5eafb4e4a87f9e
if [[ ! -d "$upstream/.git" ]]; then
  git clone --no-checkout https://github.com/ref-finance/burrowland.git "$upstream"
  git -C "$upstream" checkout --detach "$revision"
fi
# Never overwrite a different checkout or local source changes.
test "$(git -C "$upstream" rev-parse HEAD)" = "$revision"
test -z "$(git -c core.autocrlf=true -c core.filemode=false -C "$upstream" status --porcelain)"
echo '4fd64e59a0466cf3392ff1914959c59c7c086ed82300571c6e8fc89d9f7dede1  artifacts/rhea/mainnet-rhea.wasm' | sha256sum -c -
echo 'cce28364c66f5685464be08baec3c19220d991d9f5566f6cec6ca5dfd641e7c6  artifacts/integration-sources/rhea-lending/releases/burrowland_0.15.6.wasm' | sha256sum -c -
echo '4bc72fa1c23742d3e06bea47b424b6e2a3f962af606401828a5841c437f5bf65  artifacts/integration-sources/rhea-lending/releases/fungible_token.wasm' | sha256sum -c -
bash scripts/build-rhea.sh
cargo test --locked -p yieldfund-vault --features rhea --lib
compat="$HOME/.cache/yieldfund-near"
if [[ -z "${NEAR_SANDBOX_BIN_PATH:-}" && -x "$compat/bin/near-sandbox-2.14.0" ]]; then
  export YIELDFUND_SANDBOX_BIN="$compat/bin/near-sandbox-2.14.0"
  export YIELDFUND_GLIBC_DIR="$compat/glibc-2.39/root"
  export NEAR_SANDBOX_BIN_PATH="$repo/scripts/sandbox-compat.sh"
fi
export YIELDFUND_EVIDENCE_DIR=docs/evidence/rhea-local-receipts
cargo test --locked -p yieldfund-integration --test vault actual_rhea_ -- --ignored --nocapture --test-threads=1

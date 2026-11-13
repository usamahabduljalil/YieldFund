#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
fixture=tests/fixtures/reviewed-testnet/sputnikdao2.wasm
echo "2ed1d58bb2837f29b7629f833fea16bf661b4bea31fd4cceede4dc1f723d6cea  $fixture" | sha256sum --check
mkdir -p artifacts
cp "$fixture" artifacts/sputnikdao2.wasm

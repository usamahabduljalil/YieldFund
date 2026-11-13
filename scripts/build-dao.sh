#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"
revision=5434a59dec23ee0c49df8c8c4350c208a7e75b0b
archive="$repo/artifacts/sputnik-source.tar.gz"
source_dir="$repo/artifacts/sputnik-dao-contract-$revision"
mkdir -p artifacts
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 --max-time 120 "https://codeload.github.com/near-daos/sputnik-dao-contract/tar.gz/$revision" -o "$archive"
fi
echo "c6efc427071621ea47f7f3b7f419b794c63823c5aa5576d32510d9bc5190b76b  $archive" | sha256sum --check --status
# Re-extract the verified archive so a modified cached source cannot silently build.
tar -xzf "$archive" -C artifacts
export CARGO_TARGET_DIR="${YIELDFUND_DAO_TARGET_DIR:-$repo/target/dao}"
cargo +1.95.0 build --locked --manifest-path "$source_dir/Cargo.toml" --release --target wasm32-unknown-unknown -p sputnikdao2
cp "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/sputnikdao2.wasm" "$repo/artifacts/sputnikdao2.wasm"
echo "2ed1d58bb2837f29b7629f833fea16bf661b4bea31fd4cceede4dc1f723d6cea  $repo/artifacts/sputnikdao2.wasm" | sha256sum --check

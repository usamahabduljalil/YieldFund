# Milestone 2 — idle custody and actual NEAR receipts

Verified 3 November 2026 in Ubuntu WSL. This is a local contract milestone, not complete hackathon release acceptance.

Historical summary: the counts and hashes below describe the original milestone 2 run. Its four trace files were refreshed by the first milestone 3 regression run with the extended fixture and newer contracts, so they no longer identify that original binary. Use [milestone 3](milestone-3.md) and `milestone-3-receipts/` for the current final-revision evidence. Subsequent runs write to that new directory.

## Results

| Check | Result |
| --- | --- |
| Production vault and test-token Wasm | Built successfully with pinned Rust/SDK |
| Separate callback-fault Wasm | Built; production artifact rejects its test-only method |
| Accounting unit tests | 6 passed |
| Vault unit tests | 9 passed |
| Real Sandbox scenarios | 4 passed, 0 failed; final run 39.23 seconds |
| cargo fmt --all -- --check | Passed |
| cargo clippy --locked --workspace --all-targets -- -D warnings | Passed |

Frontend files and dependencies were not changed in this phase. The previous web checks are recorded separately in milestone 1; they were not claimed as newly rerun here.

The four Sandbox tests execute 93 recorded fixture calls across isolated networks. All scenarios run actual Wasm and the standards-based token. The receipt traces include expected failures; these are assertions, not hidden suite failures.

| Scenario / trace | Proven behavior |
| --- | --- |
| [Deposits and exit](milestone-2-receipts/deposits-and-exit.json) — 31 calls | Unregistered deposit refund; insufficient storage rejection; 1,000-token accepted deposit; invalid-message and fake-token refunds; forged hook/private callbacks rejected; guardian checks; deposits paused while 200-token exit remains available; no second payment or donation method |
| [Failed transfer and retry](milestone-2-receipts/failed-transfer-and-retry.json) — 23 calls | Recipient unregisters from token; actual payout receipt fails; callback restores 1,000 nominal/200 reserved; re-registration and explicit retry pays 200 once; cancellation prevents later processing |
| [Quarantine and final exit](milestone-2-receipts/quarantine-and-final-exit.json) — 19 calls | Deposit cap refund; direct 500-token transfer creates no units/yield; checkpoint excludes it; final 1,000-unit exit leaves only those 500 excluded tokens; treasury receives zero |
| [Interrupted callback](milestone-2-receipts/interrupted-callback.json) — 20 calls | Token transfer actually pays 200; injected final callback fails; effective cash/units stay 800; operation remains transfer-pending with outbound reservation 200; retry/cancel/new deposits cannot cause a second payout |

Values above use the token's six-decimal scale. The integration suite records raw base-unit strings. The token's symbol is tUSD; it is a test fixture with no asserted dollar value.

## Artifacts and toolchain

| Artifact | SHA-256 |
| --- | --- |
| `artifacts/yieldfund_vault.wasm` | `fbd4776128c48c821a9f6d0a72065e020b84c25ef719d1d978467dbaa17f9455` |
| `artifacts/yieldfund_test_token.wasm` | `1e22e0afefecbcef57415c96bdbeefe440f675aaabada45255ac51f9587af9ad` |
| `artifacts/yieldfund_vault_faults.wasm` (local tests only) | `add09910c13c3e9046a8a2e3ccf8e16eeec5b2fdd1934e7a71250da5a904c532` |

Rust 1.95.0; near-sdk and near-contract-standards 5.30.0; near-api 0.8.7; near-sandbox crate 0.4.0. Sandbox executable: release 2.14.0, commit `bc4e9e8cfb03d9e82f027883055624e18576993e`, protocol 88, minimum protocol 84. Cargo.lock captures transitive versions. Generated Wasm is ignored by Git and rebuilt from source; hashes describe the tested artifacts, not a public deployment or cross-machine reproducibility guarantee.

## Environment issue and resolution

The first Sandbox attempt failed before any contract execution: Ubuntu 22.04's glibc 2.35 could not launch a binary needing glibc 2.38/2.39. An official Ubuntu 24.04 `libc6_2.39-0ubuntu8.9_amd64.deb` was downloaded over HTTPS and extracted into a project-specific home cache. `scripts/sandbox-compat.sh` invokes its loader for Sandbox only. No `apt` upgrade, system libc replacement, global `LD_LIBRARY_PATH` or Docker change was made.

- Package source: [Ubuntu archive](https://archive.ubuntu.com/ubuntu/pool/main/g/glibc/libc6_2.39-0ubuntu8.9_amd64.deb).
- Downloaded package SHA-256: `ff5557d99b51f761c4b7c92368b9cc45565eda17df9bf9eb4b134d09825008be`.
- Official Sandbox binary SHA-256: `797b9d7a9a23907048d68a427e86a55c94f1de232dbfb8b8a1eec09ecef3bf13`. It was downloaded by near-sandbox from NEAR's official build storage.
- Cache binary: `$HOME/.cache/yieldfund-near/bin/near-sandbox-2.14.0`.
- Extracted library root: `$HOME/.cache/yieldfund-near/glibc-2.39/root`.

For a fresh compatible Linux host, no wrapper is required. For an older host using the same isolated layout, extract the pinned Ubuntu package using `dpkg-deb -x` (not `dpkg -i`), copy the official Sandbox binary to the cache path above, and make `scripts/sandbox-compat.sh` executable. `test-contracts.sh` detects these cached files or respects an explicit `NEAR_SANDBOX_BIN_PATH` override after checking its version.

Verified commands from repository root:

```sh
export CARGO_TARGET_DIR="$HOME/.cache/yieldfund-near/target"
bash scripts/build-contracts.sh --with-test-faults
cargo test --locked -p yieldfund-accounting -p yieldfund-vault -p yieldfund-test-token --lib
export YIELDFUND_SANDBOX_BIN="$HOME/.cache/yieldfund-near/bin/near-sandbox-2.14.0"
export YIELDFUND_GLIBC_DIR="$HOME/.cache/yieldfund-near/glibc-2.39/root"
export NEAR_SANDBOX_BIN_PATH="$PWD/scripts/sandbox-compat.sh"
cargo test --locked -p yieldfund-integration --test vault -- --nocapture
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
```

`bash scripts/test-contracts.sh` combines the build and test steps and now reuses the prepared compatibility cache automatically.

## Acceptance boundary

AC02 and AC05 have concrete idle-custody token evidence. Relevant parts of AC09/AC10 are covered by authentication, failed-transfer retry and interrupted-callback tests. AC03/04/06/07/08/11 require the actual strategy and DAO flows; pure accounting tests are not substitutes. AC01/frontend signing and complete AC12 release documentation also remain open.

In particular, interrupted callbacks and unexplained shortfalls **remain locked without an automated recovery path**. This prevents double payment but is not complete operational recovery. Do not accept public funds until the remaining design and receipt-level tests are complete. No Rhea, Trezu or Sputnik integration, real yield donation, public-chain deployment, mainnet operation or user-wallet signing occurred in this phase.

Primary implementation references: [NEAR integration testing](https://docs.near.org/smart-contracts/testing/integration-test), [near-sdk 5.30.0](https://docs.rs/near-sdk/5.30.0/near_sdk/), and the pinned `near-contract-standards` source in the Cargo dependency tree.

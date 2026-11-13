# Milestone 3 — funded strategy, settlement and DAO

Verified 3 November 2026 in Ubuntu WSL, on fresh loopback-only NEAR Sandbox 2.14.0 networks. Actual contracts and test-token receipts were executed; no public-network account or user wallet was used. The browser remains a local preview.

## Final verification

| Check | Result |
| --- | --- |
| Normal vault, token, simulator Wasm | Built successfully |
| Separate fault/control artifacts | Built; test methods absent from normal artifacts |
| Pinned upstream Sputnik source | Unmodified source/lockfile builds; archive and Wasm hash checks pass |
| Rust unit tests | 18 passed: 6 accounting, 12 vault |
| Real Sandbox scenarios | 10 passed, 0 failed; final run 71.26 seconds |
| TypeScript tests | 17 passed: 13 reference model, 4 unsigned DAO builder tests |
| TypeScript typecheck / production web build | Passed |
| Rust formatting / all-target all-feature Clippy | Passed, warnings denied |

Commands from repository root:

```sh
npm install --package-lock-only --ignore-scripts
npm test
npm run build
CARGO_TARGET_DIR=/home/crownab/.cache/yieldfund-near/target \
  YIELDFUND_DAO_TARGET_DIR=/home/crownab/.cache/yieldfund-near/dao-target \
  bash scripts/test-contracts.sh
cargo fmt --all -- --check
CARGO_TARGET_DIR=/home/crownab/.cache/yieldfund-near/target \
  cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
```

Cache paths are optional and specific to this WSL environment. The runner reuses the isolated glibc wrapper documented in milestone 2. `scripts/build-dao.sh` fetches verified upstream source on a fresh machine. A Windows `curl.exe` download was used during initial setup; WSL compiled the identical verified archive. A plain native `cargo check --workspace` initially failed because NEAR SDK requires a Wasm target or unit-testing configuration; the correct Wasm builds and test/Clippy commands above passed. Two initial module visibility errors were corrected before tests. No final test failures remain.

## Receipt evidence

Ten traces in `milestone-3-receipts/` contain **332 recorded fixture calls**. Expected failures are asserted deliberately. Each trace contains actors, methods, arguments, final-result flags and nested outcome IDs, executors, child receipt IDs and logs. IDs only refer to these ephemeral local networks; they are not public explorer links. Setup deploy outcomes are checked in the harness; the trace records initialization and subsequent calls. Assertions also read balances, positions, policy and proposal status directly from the deployed contracts.

| Scenario | Evidence |
| --- | --- |
| [Funded yield and DAO payment](milestone-3-receipts/funded-yield-dao-payment.json) | 1,000 allocated, actual controller funds 30 profit; direct 50 strategy/40 vault transfers excluded; only 30 donated; unchanged 1,000 nominal backing; council policy read; missing bond, supporter vote, changed recipient and duplicate vote rejected; two distinct approvals pay 20 with token receipt; treasury retains 10; healthy 200 exit |
| [Loss, delay and recovery](milestone-3-receipts/loss-delay-recovery.json) | Actual 100-token loss moves to sink; frozen redemption queues one ID; superseding redemption rejected; no payout during freeze; 900/1,000 backing; 200 minimum refuses 180 quote; cancel/re-request pays 180; remaining 720/800; deposits/donation blocked; funded 90 recovery permits only 10 donation |
| [Partial supply and donation retry](milestone-3-receipts/partial-supply-donation-retry.json) | 1,000 allocation uses 600 and refunds 400 without extra units; replay rejected; 30 profit recognized; unregistered DAO transfer fails and restores once; registration/retry sends 30 once |
| [Interrupted donation callback](milestone-3-receipts/donation-interrupted-callback.json) | DAO actually receives 30; injected finalizer failure leaves outbound reservation/global lock; confirmed donation counter remains zero; retries/new deposits blocked, no double payment |
| [Zero supply and total loss](milestone-3-receipts/zero-supply-total-loss-auth.json) | Zero accepted supply returns all capital; unauthorized allocation/controls/loss/redemption and forged callbacks rejected; forged return refunded; actual full 1,000 loss; zero-minimum final exit burns units without zero FT transfer; normal simulator rejects control methods |
| [DAO payment failure/retry](milestone-3-receipts/dao-failed-payment-retry.json) | Second approval cannot pay unregistered recipient; nested failure and `Failed` status; treasury still owns 30; registration plus authorized `Finalize` pays 20; completed replay fails |
| [Deposit regression](milestone-3-receipts/deposits-and-exit.json) | Fixed-token authentication, resolver refunds, paid storage, guardian pause, healthy exit and callback restrictions |
| [Withdrawal failure regression](milestone-3-receipts/failed-transfer-and-retry.json) | Confirmed payout failure restores claim/cash once, safe retry and cancellation |
| [Withdrawal callback fault](milestone-3-receipts/interrupted-callback.json) | Real token payout plus failed callback keeps lock/reservation; cannot pay twice |
| [Quarantine/final exit regression](milestone-3-receipts/quarantine-and-final-exit.json) | Cap enforcement, unsolicited transfers excluded, final claimant receives all backing |

Unit tests additionally exercise unknown allocation results, strategy return sender/operation/duplicate restrictions, stale callback versions and failure after a strategy return was already credited. These remain locked; no unsafe rollback is inferred from an outer error.

## Build identities

Rust 1.95.0; YieldFund SDK/standards 5.30.0; near-api 0.8.7; near-sandbox crate 0.4.0 / executable 2.14.0. Sputnik uses its own unmodified lockfile (SDK/standards 5.24.1) and Rust 1.95.0. This is a pinned local build, not an upstream reproducible-container attestation. The working repository has not been committed or published, so no project commit SHA is invented.

| Artifact | SHA-256 |
| --- | --- |
| `yieldfund_vault.wasm` | `170f9b9e1d11a766528d036df980031faa734bae4122ae772da0c4fa83722084` |
| `yieldfund_vault_faults.wasm` | `92ab8ab6deedac3d427127d9ac9832f2f323d423f6540e382e77e573138ed684` |
| `yieldfund_test_token.wasm` | `1e22e0afefecbcef57415c96bdbeefe440f675aaabada45255ac51f9587af9ad` |
| `yieldfund_strategy_simulator.wasm` | `2900d891851a0fd844bed39fda877bb983ece54d2f99f1fb2a3c0c79c009004b` |
| `yieldfund_strategy_simulator_controls.wasm` | `4ebe6b2bbe5b6b7b15ab18e29df8a1fdedd7396960446d16e50efe0a498ccb1a` |
| `sputnikdao2.wasm` | `2ed1d58bb2837f29b7629f833fea16bf661b4bea31fd4cceede4dc1f723d6cea` |
| Sputnik source archive | `c6efc427071621ea47f7f3b7f419b794c63823c5aa5576d32510d9bc5190b76b` |

Sputnik source revision: [`5434a59dec23ee0c49df8c8c4350c208a7e75b0b`](https://github.com/near-daos/sputnik-dao-contract/tree/5434a59dec23ee0c49df8c8c4350c208a7e75b0b). Its governance and token-payment implementation is reused; no replacement multisig is written. Source archive/build artifacts remain under ignored `artifacts/`, fetched by the build script.

## Acceptance boundary

AC03–AC08 and AC11 now have concrete local contract evidence alongside the prior deposit/authentication/retry tests. This is not complete P0 acceptance: browser chain reads/signing, receipt-linked UI, deployment authority/manifest verification, Trezu/Rhea gates and automated evidence-based callback recovery are unfinished. No new browser screenshots are claimed because the UI was unchanged. UI wording remains concise and the landing page stays wallet-free.

Simulator gains are controller-funded test tokens, not accrued lending yield. Unknown callbacks remain deliberately fail-closed. Full-access fixture keys can upgrade/impersonate contracts, and the DAO self-initializes its factory information. Fresh deployment is required for this changed Borsh layout. Do not use this milestone as evidence of production security or authorization for public deposits.

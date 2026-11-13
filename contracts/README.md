# NEAR contract layer

The current milestone implements **funded simulated strategy settlement**: vault deposits/allocation, complete redemption, proportional loss, eligible yield donations and existing Sputnik governance. All run as real Wasm in local Sandbox. No public deployment is configured. Live lending and frontend chain integration are not implemented.

## Components

| Package | Implemented boundary |
| --- | --- |
| `accounting` | Checked integer accounting, proportional redemption, surplus and impairment rules |
| `campaign-vault` | Immutable one-token configuration, authenticated deposits, paid storage, withdrawal reservations, fixed-token reconciliation, private callbacks and journal views |
| `test-token` | Test-only fixed-supply NEP-141/145/148 token using NEAR's standards implementation; 6 decimals; no post-init mint or clawback |
| `strategy-simulator` | Single-vault funded strategy; exact-token supply/profit hooks, returned-promise redemption, separate loss/delay/partial test controls |
| Upstream `sputnikdao2` | Unmodified pinned source; three-member, two-approval token-payment policy tested locally |
| `tests/integration` | Token transfers and nested receipt assertions in a local Sandbox, including failed and interrupted payouts |

`allocate_idle`, `redeem_strategy` and `distribute_yield` are implemented. The fixed beneficiary receives only proven, liquid surplus after reconciliation. The frontend continues to use its labeled local preview; it is not wired to these ephemeral networks. See [strategy-and-dao.md](../docs/contracts/strategy-and-dao.md) for the complete new API and state-machine boundaries. Fresh deployment is required; milestone 2 state is not migrated.

## Build and verify

Use Linux or Ubuntu WSL with a C/C++ build toolchain, CMake, and internet access for initial dependencies and the Sandbox binary. Rust 1.95.0 is pinned because near-sdk 5.30.0 requires Rust 1.95. SDK and standards are pinned to 5.30.0, near-api to 0.8.7, near-sandbox to 0.4.0, and the Sandbox executable to 2.14.0. Retain `Cargo.lock`.

```sh
rustup target add wasm32-unknown-unknown
bash scripts/build-contracts.sh
bash scripts/build-dao.sh
bash scripts/test-contracts.sh
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
```

Run from the repository root. On WSL, an optional `CARGO_TARGET_DIR` under the Linux home directory avoids slow compilation on a mounted Windows filesystem. The scripts still copy resulting Wasm into the repository's ignored `artifacts/` directory.

On this Ubuntu 22.04 workspace, `test-contracts.sh` automatically reuses the isolated runtime under `$HOME/.cache/yieldfund-near/`. It does not change system libraries. On a fresh older host, prepare a glibc 2.39 runtime or use Ubuntu 24.04+. The exact compatibility setup and artifact identities are recorded in `docs/evidence/milestone-2.md`.

`test-contracts.sh` builds separate `yieldfund_vault_faults.wasm` and `yieldfund_strategy_simulator_controls.wasm` artifacts. Callback faults and loss/liquidity/partial controls are absent from the normal artifacts; the Sandbox suite checks this. Never deploy the fault artifact outside an ephemeral local test network. All simulator contracts are test infrastructure. Sandbox uses public fixture keys, independent of user wallets. Sputnik source and build hashes are pinned in `scripts/build-dao.sh`; optional `YIELDFUND_DAO_TARGET_DIR` controls its separate compilation cache.

## Custody conventions

- `cash` is recognized token cash, net of outgoing reservations and excluded extras. It is not raw `ft_balance_of`. `excluded` is the latest observed excess outside recognized backing. `reserved_outbound` is separate; do not subtract it from `cash` again.
- An accepted deposit adds its base-unit amount to cash and nominal units. Invalid message, unregistered position, pause, cap violation or active operation returns all unused tokens through the token resolver. A fake predecessor panics before trusting `sender_id`.
- Withdrawal requests reserve available units but retain them in the nominal denominator. Processing locks the vault, queries only the fixed token, then removes payout cash and nominal units before sending tokens. The request owner is always the recipient.
- Confirmed transfer failure restores cash and units once, leaving the request reserved and retryable. Success finalizes paid history. A missing/interrupted callback leaves reservations and the global lock intact. There is no timeout unlock, force-success, sweep or blind payout retry.
- Successful oversized transfer responses also stay locked. Callback reads are size-bounded; callbacks authenticate stage and operation version, in addition to the generated private-predecessor check.
- Unsolicited tokens never become yield. Excess is recomputed so transient rejected-deposit refunds can leave without falsely reducing recognized cash. An unexplained raw balance below recognized cash locks for reconciliation. Only authenticated, completed strategy redemption recognizes funded gains/losses.
- Guardian pause blocks new deposits, allocation and donation, but permits strategy redemption and reconciled withdrawals. Configuration has no financial setters. Initialization must originate from the vault account itself, preventing third-party configuration after deployment.

## Storage and gas

`storage_costs()` returns integer yoctoNEAR strings. A position prepays 512 storage bytes; a permanent operation prepays 2,048 bytes plus one yoctoNEAR. Account IDs and operation errors are bounded. Runtime storage-delta assertions verify headroom; unit tests cover maximum account-ID length. Excess attached NEAR is refunded. Fixed registration/history fees are non-refundable. The vault is not an FT and does not claim a complete NEP-145 storage interface; the test token implements it.

`advance_operation`, `cancel_withdraw`, `recover_operation` and `set_paused` require exactly one yoctoNEAR. Withdrawal/checkpoint/donation starts and recovery require at least 110 Tgas; allocation requires 160 and redemption/retry 220. Integration tests attach 300 Tgas. Query, reconciliation, transfer and callback budgets are bounded. Each operation is O(1); history pagination is capped at 50 records.

## Incomplete recovery and trust limits

A callback lost after an outgoing token payment is deliberately fail-closed. Stage-specific recovery can now restart interrupted balance reads or prove a completed simulator redemption from authenticated contract state. It cannot unlock unknown outgoing payments, allocation outcomes or unexplained custody shortfalls. See [recovery](../docs/contracts/recovery.md). Complete those remaining paths before claiming P0 completion or accepting public deposits. Receipt IDs are collected off-chain from finalized outcomes; they are not invented inside contract state.

The vault assumes the configured token has the pinned standard token's atomic `ft_transfer` semantics. A symbol/decimals match is insufficient. Retained full-access deployment keys can replace code or call private methods as the vault account; remove or govern them before any stronger trust claim. Local fixture accounts intentionally retain keys. There is no production-readiness or security-audit claim.

See `docs/contracts/idle-vault-api.md`, `agent.md` and milestone evidence for current behavior and remaining work.

# Milestone 5 — safe interrupted-operation recovery

Verified 3 November 2026 with real Wasm on ephemeral local Sandbox 2.14.0. No public deployment, user-wallet transaction or upgrade was performed. Recovery intentionally covers only interrupted balance reads and completed simulator redemptions with authenticated contract-read evidence.

## Final checks

| Check | Result |
| --- | --- |
| Rust units | 22 passed: 6 accounting + 16 vault |
| Real Sandbox integration tests | 13 passed, 0 failed; browser serving fixture ignored; 256.53 seconds |
| TypeScript tests, live RPC enabled | 35 passed |
| Typecheck / production build | Passed |
| Hosting packaging tests | 4 passed |
| Rust formatting / all-target all-feature Clippy | Passed; warnings denied |
| Normal and test-fault/control Wasm | Built successfully |

Full contract regression includes the original ten scenarios plus three recovery tests (the redemption test executes independent funded-profit and total-loss networks). Historical receipt evidence was preserved; 14 new traces containing 451 recorded fixture calls are in `milestone-5-receipts/`.

## Recovery evidence

| Trace | Assertions |
| --- | --- |
| `recovery-balance-withdrawal-donation.json` | Injected balance callback failure leaves 200-token withdrawal unpaid; early recovery fails; after cooldown, the original request pays 200 once. A separately interrupted donation balance read sends 30 once. Repeat recovery fails without changing either recipient balance. |
| `recovery-funded-redemption.json` | Actual 1,030 returned; original vault finalizer fails; strategy reports completed return; forged recovery callback and early attempt fail. Recovery leaves cash 1,030 and nominal 1,000, permits only 30 eligible yield, and never resends or recredits the return. |
| `recovery-zero-return.json` | Actual 1,000 total loss leaves zero strategy return; interrupted finalizer recovers to zero cash/yield and 1,000 nominal claims. No token transfer is fabricated. |
| `recovery-rejects-unknown-payment.json` | Actual 200-token withdrawal succeeds but final callback fails. Even after cooldown, recovery rejects it; the original reservation stays locked and no second payment occurs. |

Unit tests additionally interleave old/new callback versions, busy proof and a late authenticated return; malformed, wrong-token, wrong-vault, wrong-operation and nonzero-position proofs all keep the lock. The client rejects unsupported recovery stages, early attempts and a changed queued redemption, and builds only the fixed operation ID/version call.

The first new integration compile exposed sibling-helper visibility errors, corrected with test-module visibility. A repeated recovery test initially failed because a fixed number of skipped Sandbox blocks did not reliably satisfy the second wall-clock cooldown. The harness now checks finalized block timestamps after fast-forwarding rather than assuming a duration. No production delay or state check was weakened. All final tests pass.

## Browser and artifact boundaries

The optional `YIELDFUND_BROWSER_RECOVERY=1` fixture uses a separate fault vault to leave checkpoint #4 interrupted after the normal funded strategy/DAO flow. Its manifest discloses test faults, retained keys and read-only mode. Desktop and mobile screenshots are `screenshots/recovery-desktop.png` and `screenshots/recovery-mobile.png`; the page shows the cooldown, then a disabled recovery button because Sandbox signing is disabled. Browser wallet signing and the connected-wallet recovery review were not executed.

Production vault state layout is unchanged by recovery; extra fault flags/methods are compiled only into the fault artifact. The normal vault code hash changed, so a new reviewed deployment manifest is required. No in-place migration/upgrade rehearsal was performed. Existing public-deployment and unknown-payment recovery blockers remain in `agent.md` and [recovery rules](../contracts/recovery.md).

SHA-256 of artifacts built for this run:

| Artifact | SHA-256 |
| --- | --- |
| Normal vault | `250fd465d930ac23081e3e04929d59b036e82a30f11fed7e1dd799efc77d00ad` |
| Fault vault | `844c9f2b45f813759cf45318ed26358fc21ab4568e45a4132c6236a72feda81e` |
| Normal simulator | `2900d891851a0fd844bed39fda877bb983ece54d2f99f1fb2a3c0c79c009004b` |
| Controls simulator | `4ebe6b2bbe5b6b7b15ab18e29df8a1fdedd7396960446d16e50efe0a498ccb1a` |

Commands: `bash scripts/build-contracts.sh --with-test-faults`; `cargo test --locked -p yieldfund-accounting -p yieldfund-vault -p yieldfund-test-token -p yieldfund-strategy-simulator --lib`; `cargo test --locked -p yieldfund-integration --test vault -- --nocapture`; `cargo fmt --all -- --check`; `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`; `YIELDFUND_LIVE_SANDBOX=1 npm test`; `npm run build`; `npm run test:sites`. WSL used the existing local glibc wrapper and `/home/crownab/.cache/yieldfund-near/target` cache documented in the contract README.

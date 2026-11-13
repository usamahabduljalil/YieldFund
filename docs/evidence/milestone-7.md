# Milestone 7 — concrete deployment review and funding preflight

5 November 2026, Africa/Lagos. Preparation complete; public contract execution awaits approval. See [deployment review](../../deployments/DEPLOYMENT_REVIEW.md).

## Changes

- Four distinct contract keys generated locally using NEAR CLI 0.30.1. Secrets are outside the repository in an ACL-restricted current-user-only directory. Public keys appear in the complete review input and exact unsigned plan. Actor keys remain in Windows Credential Manager.
- Added `preflight` to the deployment tool. It rejects changed plans and unreviewed Wasm; verifies testnet and final-block freshness; checks all actor accounts, their key permissions, and conclusive absence of every new contract account; queries current storage cost and gas price; calculates operator and contract funding separately.
- Independent account reads run concurrently and remain pinned to one block. Evidence must still be fresh when reads finish. RPC errors and wrong-block data cannot masquerade as account absence.
- Reduced the provisional contract funding from 40 to 22 NEAR: 6 vault, 5 token, 4 strategy, 7 DAO. Storage estimates include actual Wasm bytes, 64 KiB state headroom, a conservative initialization gas allowance and 1 NEAR contract operating reserve. These are estimates, not guaranteed final state size or execution fees.
- Prepared a hash-bound proposal for three 5 NEAR council-to-operator transfers and a 2 NEAR total gas allowance. No council funds were moved and nothing was signed.
- Selected council 3 as fictional rehearsal recipient and council 2 as the normal-build inactive loss sink in the review input. No proposal payment or loss simulation is included in the requested deployment.

## Verification

`npm test`: **76 passed**, one optional live Sandbox test skipped. Typecheck and formatting checks passed. The 16 new preflight cases cover correct budgeting, staking exclusion, storage reserve, zero available balance, rising storage/gas prices, malformed data, missing actors, existing contract accounts, restricted keys, stale/wrong-network/wrong-block evidence, RPC failures and plan tampering.

Actual CLI plan generation verified all four normal Wasm hashes and emitted [the review plan](../../deployments/testnet-plan.review.json). The two public read-only preflight runs retained [initial](milestone-7-preflight.json) and [latest](milestone-7-preflight-final.json) observations. Both report the operator funding shortfall of **14.24182 NEAR**. Each proposed contract allocation covers the current estimated requirement. Exact actor public keys match the milestone 6 creation evidence.

The public faucet UI allowed at most 2 NEAR; a single 2 NEAR request returned an error. Subsequent finalized state confirmed the operator still had 10 NEAR. No retries or limit workaround were attempted. Its error screen is retained under `screenshots/testnet-faucet-error.png`.

CLI 0.30.1 does not implement the newer documented `generate-keypair` command; its supported `account create-account fund-later use-auto-generation save-to-folder` path was used instead. This generates local credentials only. Generated secret values were not printed or placed in project files. The key directory's ACL was verified to contain only current-user FullControl with inherited rules disabled.

No frontend or Rust contract source changed, so browser visual tests and Rust scenarios were not rerun. The production frontend remains in preview, and the generated testnet manifest remains read-only. Public contract audit and actual wallet rehearsal remain pending. The initial-state margin is a preparation estimate that must be validated against actual initialized contracts.

## Next step

Approve or revise the [exact deployment/funding review](../../deployments/DEPLOYMENT_REVIEW.md). After approval, rerun preflight, compare actor keys, execute and retain finalized receipts one bounded step at a time, audit public contracts and then prepare the separately authorized wallet rehearsal. Unknown outgoing payment/allocation and simulator-internal callback recovery remain unresolved before public deposits.

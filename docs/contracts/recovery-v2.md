# Recovery v2 — funded testnet simulator

This is a fresh-deployment protocol. It changes the token, vault, simulator and factory state layouts. Do not upgrade the historical contracts with these Wasm files without a separately designed migration. Existing keyless factory children cannot be upgraded. The current public manifests still point to the historical read-only deployment until a reviewed v2 release and wallet acceptance finish.

## Why the old deployment was read-only

A token transfer and its vault callback execute in different receipts. The payment may succeed while the callback fails. A timeout, recipient balance, browser log or guardian assertion cannot prove the payment's outcome. Restoring the reservation and paying again could pay twice. The v1 factory likewise had no way to resume after one child or registration failed.

## Atomic payment evidence

The fixed-supply **demo token** adds `ft_transfer_once(receiver_id, amount, sequence)` and `ft_resolve_once` with the same arguments. Both require one yoctoNEAR and scope records to the predecessor account. A successful transfer and its durable receipt commit atomically. Repeating the same sequence and intent returns the recorded result; changing the amount/recipient or using an older sequence fails.

Recovery returns the existing receipt. If the attempt has not executed, it writes a cancellation fence atomically. A delayed original transfer then returns `applied: false` without moving tokens. Only after validating the exact sender, receiver, amount and sequence does the vault finalize history or restore cash, units and reservations. Missing/malformed/failed evidence keeps the lock. The recovery callback cannot infer failure merely because its own promise failed.

Each sender keeps a bounded latest receipt. Registration includes 2,048 bytes for payment and transfer-call records. Journal users cannot unregister, because removing the sequence fence would permit old attempts to become executable again. This is a disclosed test-token extension, **not a claim that arbitrary NEP-141 assets support recovery**. Standard `ft_transfer` and `ft_transfer_call` remain separate APIs. Real Rhea/mainnet assets need their own verified adapter/evidence design.

## Allocation and strategy return

`ft_transfer_call_once` records the immutable intent before dispatch, then commits the standard token refund and `used` result in the same resolver receipt. Repeated/stale attempts cannot send again. `ft_resolve_call_intent` returns the durable result, or fences an unexecuted attempt with zero used. An already pending resolver is never treated as failure.

- Allocation recovery credits only the recorded refund and sets the strategy book to recorded used tokens. Partial supply is supported; no allocation is resent.
- Simulator recovery resolves its own outgoing return against the token journal. It clears `busy` only for a proven full return or zero-used refund/cancellation. Return attempts have independent monotonic sequence fences, so late callbacks and delayed original redemption requests cannot complete a newer attempt.
- Vault redemption recovery validates simulator bindings, operation and attempt sequence. Its authenticated return hook already credited cash once. Recovery never credits that amount again. A proven zero-used failed attempt becomes retryable; a completed return settles the book and eligible surplus.

The vault's existing five-minute cooldown, active-operation lock, private callbacks and version checks still apply. Recovery accepts no caller-supplied amount, destination, valuation or outcome. Pending evidence, impossible partial returns and unexplained custody shortfalls stay locked; there is no force-success, balance-based payout guess or administrator sweep.

## Resumable campaign creation

The v2 factory records two child-completion bits, three token-registration bits, a generation and an update time. `recover_campaign({id,version})` requires one yoctoNEAR, 300 Tgas and a five-minute cooldown. Anyone can resume the immutable intent; creators cannot change its token, cap, treasury, metadata or child destinations.

Recovery reads both child configurations and all three token registrations. Exact matching initialized children are preserved. Missing children use the original atomic create-account/deploy/initialize batch: `create_account` fails on an existing account before it can be redeployed or funded again. Registrations are idempotent NEP-145 calls. Late callbacks fail generation checks.

Native reserves cover every unfinished campaign's remaining child funding and registrations. A retry cannot use funds reserved for another campaign or storage. If a failed receipt's native refund has not arrived, progress is saved and setup waits for liquidity instead of charging a second creation deposit. Successful proofs release liabilities once. Recovery completes the original setup; it does not offer cancellation or an arbitrary refund/sweep of child storage funds.

## UI and release gates

- `Resume setup` appears only for a manifest-pinned v2 factory and unfinished campaign. It rebuilds the review from fresh chain progress and cooldown.
- `Resolve payment` and `Resolve allocation` appear only for a v2 vault. Legacy deployments keep their original supported recovery actions.
- A finalized incomplete creation permits only a matching recovery action. Unknown wallet outcomes still require receipt reconciliation before another send. A failed original receipt whose campaign later becomes ready is labelled `recovered`, not silently relabelled a successful transaction.
- Public activation requires normal artifact hashes, matching registration costs, fresh deployments, on-chain state reconciliation, and live browser-wallet transaction acceptance. Fault artifacts are exclusively for local Sandbox.

`scripts/prepare-vercel.mjs` defaults to the historical read-only manifest. Future activation uses `deployments/public-runtime.json`, the matching public registry, and `deployments/public-signing-acceptance.json`. The acceptance record must bind the canonical SHA-256 of both manifests and `recovery-release.review.json`, mark every exported `acceptanceChecks` entry passed, and list one unique finalized transaction hash per reviewed step. `scripts/public-release.mjs` validates this before packaging. This is a maintainer-reviewed evidence gate, not independent on-chain attestation. No acceptance record is present until actual public verification passes.

## Verification

Run `YIELDFUND_EVIDENCE_DIR=docs/evidence/milestone-16-receipts bash scripts/test-contracts.sh` in Linux/WSL. Tests inject child initialization, registration and callback failures, prove single payment after recovery, fence a cancelled payment before retry, recover partial allocation refunds, and recover the simulator finalizer before donating only eligible surplus. See [milestone 16](../evidence/milestone-16-recovery.md) for actual results and outstanding acceptance work.

# Stage-specific interrupted-operation recovery

This document describes the **historical v1 public deployment**. The new source protocol adds payment, allocation, simulator-finalizer and factory recovery; see [Recovery v2](recovery-v2.md). Its new state layouts require fresh deployments and do not retroactively change the historical contracts.

`recover_operation({ operation_id, version })` is a permissionless payable vault action. Attach exactly 1 yoctoNEAR and at least 110 Tgas (the browser attaches 300 Tgas). The active operation must match both arguments, and at least five minutes must have elapsed since its last saved update. The delay rate-limits retries; elapsed time is never evidence that a transfer failed.

| Interrupted stage | Recovery behavior |
| --- | --- |
| `reconciling`, checkpoint/withdrawal/donation, no outgoing payout | Supersede the old callback version and query the exact token again. The normal settlement path still checks capital, provenance, pause, minimum and reservations before any payment. |
| `redeeming` or `needs_reconciliation`, redemption only | Query the configured simulator's `get_position`; never call `redeem_all` again. Complete only with authenticated evidence described below. |
| `transfer_pending`, withdrawal/donation | Unsupported; preserve lock and reservations, even if a browser or caller claims the payment succeeded. |
| Allocation uncertainty, unexplained cash shortfall, other stages | Unsupported; preserve lock. |

The action accepts no amount, recipient, balance, status or caller-supplied receipt assertion. Old callbacks fail the operation/version/stage checks before modifying balances. A recovered balance read can complete the original withdrawal or donation, so the browser review shows its original amount, owner/recipient and minimum. A stalled read after a previously confirmed failed payout starts with a zero outgoing reservation; that failed transfer has already been restored by its authenticated callback.

## Redemption evidence

The vault issues a cross-contract read to its immutable strategy account and processes the result through a private callback. It requires the expected simulator mode, exact vault/token bindings, `last_redeem == operation_id`, `busy == false`, and `position == 0`.

For the pinned simulator code, that state is reachable for this operation only after the full token resolver and strategy finalizer complete, or after a zero-position redemption returns synchronously. A failed/partial return leaves `busy` set because the finalizer panics atomically. The vault's token-authenticated return hook already recorded any nonzero amount once against this operation. Recovery clears the strategy book and settles eligible surplus using that recorded amount; it never credits cash again. Total loss therefore recovers with zero cash and zero eligible yield, while 1,000 plus 30 funded profit permits only 30 eligible tokens.

The global active-operation lock prevents reallocation or another redemption while proof is pending. Missing, malformed, busy, mismatched or nonzero-position evidence leaves the operation locked. The stage remains `redeeming` so a late authenticated return can still arrive; subsequent attempts wait another five minutes. Superseding versions reject delayed original callbacks and duplicate recovery responses.

These guarantees depend on the reviewed simulator implementation and fixed bindings. They are not a general proof system for arbitrary lending adapters. Retained full-access keys or upgrade authority can replace code; deployment disclosures and hash checks remain required. No public contract was upgraded during implementation.

## What remains unresolved

NEP-141 balances cannot by themselves prove that a particular outgoing payment happened: recipients can spend tokens, and unsolicited transfers can hide a balance change. This implementation does not restore or mark an unknown withdrawal/donation complete from a balance comparison, guardian assertion, timeout or browser log. Unknown allocation results and failure of the simulator's own finalizer also remain locked. A future recovery design needs durable, contract-verifiable evidence for those cases; there is no administrative unlock.

This is consistent with NEAR's [independent asynchronous calls](https://docs.near.org/smart-contracts/anatomy/crosscontract) and [private callback requirements](https://docs.near.org/smart-contracts/security/cross-contract-calls/callbacks). Contract tests inject failures into a separate fault artifact; normal vault builds omit the fault methods and fields.

## Reproduction

Run `bash scripts/test-contracts.sh`, then review `docs/evidence/milestone-5-receipts/`. `YIELDFUND_EVIDENCE_DIR` optionally chooses another repository-relative evidence directory. Historical milestone 3/4 evidence is preserved.

For a read-only UI fixture showing an interrupted checkpoint, run `YIELDFUND_BROWSER_RECOVERY=1 bash scripts/serve-browser-fixture.sh` in Linux/WSL, then start the local frontend as described in `frontend-chain.md`. Operation #4 shows the cooldown and then Resume balance check. Browser signing remains disabled in Sandbox. The harness uses the fault vault artifact and discloses this in its manifest; never use that artifact for public deployments.

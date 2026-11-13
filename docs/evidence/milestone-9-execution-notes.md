# Milestone 9 execution — on-chain lifecycle complete

Completed 12 November 2026 (Africa/Lagos). All eleven approved calls finalized successfully; full receipt trees, exact calls, and post-call balances were independently checked. The original review SHA-256 remains efb048ff9da1a00cecdf92fae98306cdbf15fe4f8f9376c1f1b95833cdaa79ff. This completes the authorized transaction sequence; final wallet acceptance remains partial.

[Machine-readable reconciliation](milestone-9-execution.json), [receipt/state evidence](milestone-9-receipts/), [final authority audit](milestone-9-final-audit.json).

| Step | Finalized transaction hash | Receipt-tree fee, yoctoNEAR |
| --- | --- | --- |
| register-position | 8gviMwprxgvhhjVjhJDwWiCMUW4UCLoxky6PhwxSBKvd | 205723921758000000000 |
| deposit | FFQJ2dYdVBhUoZYfuK5BfVLS4tGAdDN6xfSr3YieS5Xp | 643343691274200000000 |
| allocate | 5NUq7DNGnTNJpnnE8ZsGcYWQeevy99GKYXovvinHWWfS | 1062631568942500000000 |
| fund-profit | 9abHU4XQoBjuefuZ3wYaDdxgnZaShHNQPsqws21R5fCu | 587812077452900000000 |
| redeem | 5U4RfRBoXzfySxs4npp6emDXM5ANLpNTqYzbCL7N64te | 1459987959511600000000 |
| donate | DqrWAXvoQhzVnWSwwXYn5oKCgP1kGXSvSaEFTCCXCQqf | 1093737256818000000000 |
| propose | 9N3BBjzWc98N4eF5EgKURDXtx7zrHEG7PWrMfBMiUrmw | 232553849250800000000 |
| vote-one | 29xXYHve8hpGz2Frqw4cEBLn6hAEU4VQdJrPX4umP9jh | 252726059746200000000 |
| vote-two | DhpGTKnChHqWyN5p6mgGvWsdSEG287wNamK3Xac3geci | 786833029192400000000 |
| request-withdrawal | FbWcmbwx4RVpxdG6yTnYDTms2rzaMjz8gQa2XGj1QUBK | 240355609377700000000 |
| advance-withdrawal | 7sQaDjARUZ4vXzKjxLoiyxgiMPLh6sfEDk2r52tJB1yX | 1135403454821100000000 |

Total fees: **0.0077011084781454 testnet NEAR**. External attachments: **0.187040000000000000000007 NEAR**, below the 0.188 attachment ceiling; fees remain below the separate 1.25 gas ceiling. Bond refunds are not subtracted from attachment spending.

## Final state

| Item | Final value |
| --- | --- |
| Supporter token balance | 999,170 tUSD |
| Vault cash / nominal units | 800 tUSD / 800 units |
| Strategy balance / position | 0 / 0 |
| Total eligible yield donated | 30 tUSD |
| Remaining eligible yield | 0 |
| DAO treasury | 10 tUSD |
| Council 3 recipient | 20 tUSD |
| Withdrawn / reserved | 200 tUSD / 0 units |
| Active operation / queued redemption | None / none |

Proposal #0 has two approvals and a verified 20 tUSD token payment. Withdrawal #4 completed with a 200 tUSD payout. All four vault operation records completed; total token supply reconciles to 1,000,000 tUSD.

## Execution channels and interruptions

Eight calls completed through the browser CLI wallet handoff: registration, allocation, redemption, donation, proposal, two votes, and withdrawal request. Profit funding used the external CLI controller call. The deposit used its original browser intent plus the explicitly approved nonce-bound CLI/hash recovery. Its Activity entry was recovered with the matching finalized hash.

The first vote's unused November 9 signature expired before the November 10 resume. The final withdrawal's unused November 10 signature expired before the November 12 resume. Before each replacement, public checks proved expiration, unchanged confirmed nonce, and unchanged requested action state. Old signed files were preserved in ignored artifacts; replacements were constrained to the same unused nonce. Neither old payload had a broadcast journal. See [vote validity](milestone-9-vote-validity-20261110.json) and [withdrawal validity](milestone-9-withdrawal-validity-20261112.json).

The final advance call completed through the approved CLI signer on November 12 because browser controls were unavailable. It was bound to the exact operation ID returned by the finalized request. Its browser wallet handoff, final Activity entry, and post-payment browser screenshot are **not verified**. Do not claim all eleven calls completed through the browser. Existing browser evidence includes [paid DAO proposal](screenshots/milestone-9-paid-proposal.jpg), captured November 10.

## Fixes and checks

- Released the native transaction review modal while awaiting the CLI wallet, so it no longer covers the wallet iframe.
- Preserved proposal and operation detail components during background refresh; refreshing previously removed their action controls and discarded open transaction reviews.
- Bounded RPC read concurrency/retries and shared only in-flight snapshots for the same account; write calls cannot use the read retry transport.
- Routed the legacy FASTNEAR testnet hostname to its [documented current endpoint](https://docs.fastnear.com/rpc) in the read transport. The approved manifest and persisted Activity scope retain their original values. Both old endpoint timeouts and fresh successful testnet reads were observed November 12.
- 89 TypeScript/tooling tests pass; one optional Sandbox test skipped. Production typecheck/build and all four hosting packaging checks pass; see [closeout checks](milestone-9-closeout-checks.json). No contract source change in this rehearsal.

## Remaining acceptance work

Explicit wallet rejection, account/network change during signing, final withdrawal browser handoff, and full AC01–AC12 sign-off remain open. The CLI wallet has no explicit rejection control; closing its panel gives an ambiguous outcome. All council keys share the same user's custody. Funded simulator evidence does not establish live Rhea or Trezu integration. Unknown outgoing payment/allocation and simulator-internal callback recovery remain release blockers. No publication, submission, mainnet, or public-deposit readiness claim.

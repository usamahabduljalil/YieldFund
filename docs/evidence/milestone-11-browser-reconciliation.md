# Milestone 11 — historical receipts and browser reconciliation

12 November 2026. Read-only follow-up to the completed eleven-call testnet rehearsal. No new signatures, transactions, deployment or publication.

## Fix

After reopening the saved rehearsal browser, receipt polling targeted the regular FASTNEAR node for old transactions. Browser network diagnostics recorded HTTP 408 responses. Each ten-second polling interval could start another check for the same submission while its previous check remained pending, filling the shared paced read queue and delaying the public snapshot.

The read transport now routes `tx` and explicit historical `block_id` block lookups to FASTNEAR's testnet archival endpoint. Current finalized state stays on the regular endpoint. This is restricted to the exact known provider URL; other providers and local Sandbox URLs are unchanged. The original deployment manifest and Activity storage scope remain unchanged. Write methods remain rejected. FASTNEAR documents archival RPC for older receipts and blocks in its [RPC reference](https://docs.fastnear.com/rpc), checked November 12.

The provider permits only one pending receipt check per saved submission. Concurrent timer ticks or manual recovery attempts receive an in-progress error without another network check or mutation of the saved outcome. Success and failure both release the guard. Exact hash, signer, call, block and nested-receipt verification remains required before a record becomes finalized.

## Checks

- `npm test`: 108 passed, one optional Sandbox test skipped across eight files. New cases cover historical routing, exact host restriction, unchanged request bodies, duplicate pending checks, independent submissions and retry after failure.
- `npm run build`: production typecheck and build passed.
- `npm run test:sites`: four packaging tests passed.
- Browser reload confirmed current regular RPC reads and historical archival requests. The overview showed 800 units, 800 cash, zero eligible yield, 30 donated and 10 in the DAO, with operations 1–4 completed.
- Operator position: 800 units, zero reserved, 200 paid withdrawals; withdrawal controls disabled in read-only mode. [Screenshot](screenshots/milestone-11-final-position.png), [DOM](milestone-11-position-dom.txt).
- Activity after reload: all nine saved submissions reverified as finalized, including the recovered deposit and second vote's confirmed DAO transfer. No duplicate entry was injected. [Screenshot](screenshots/milestone-11-final-activity.png), [DOM](milestone-11-activity-dom.txt).
- Withdrawal operation #4: completed, requested/payout/minimum each 200, version 15. Its linked browser submission is the original request; there is no fabricated browser entry for the CLI advance. [Screenshot](screenshots/milestone-11-final-withdrawal.png), [DOM](milestone-11-withdrawal-dom.txt).
- Treasury: 10 remaining, 30 confirmed vault funding, two-vote policy and approved proposal #0; proposal control disabled. [Screenshot](screenshots/milestone-11-final-treasury.png), [DOM](milestone-11-treasury-dom.txt).
- Proposal #0: 20 tUSD to council 3, approvals from councils 1 and 2, and “Payment receipt verified in this browser.” [Screenshot](screenshots/milestone-11-final-proposal.png), [DOM](milestone-11-proposal-dom.txt).

The browser checks include finalized snapshot blocks 277366795 and 277366965. The first refreshed load was slow while old submissions rechecked; the screen retained explicit loading/read-only/timestamp labels. The guard bounds overlapping checks; it does not guarantee RPC availability or fast response times.

A [read-only demo walkthrough](../DEMO_WALKTHROUGH.md) is prepared. No video or observed user study is claimed. [Check summary and source hashes](milestone-11-checks.json) record this revision.

## Scope and remaining acceptance

Read-only UI observations do not establish the final withdrawal's browser signing handoff. That call was completed through CLI and remains documented as such. Explicit live-wallet rejection and account/network switching during a signing request remain unverified; controlled-adapter tests are separate evidence. Unknown outgoing contract callback recovery remains a release blocker.

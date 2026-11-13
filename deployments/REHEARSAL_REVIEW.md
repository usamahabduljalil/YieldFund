# Public testnet wallet rehearsal review

Prepared 7 November 2026. **Approved by the user on 9 November 2026 ("yes approve"); all eleven calls finalized by 12 November.** This document preserves the approved scope. See [actual execution and channel differences](../docs/evidence/milestone-9-execution-notes.md); final browser acceptance remains partial.

Exact targets, arguments, gas and attachments: [testnet-rehearsal.review.json](testnet-rehearsal.review.json). Canonical JSON SHA-256: `efb048ff9da1a00cecdf92fae98306cdbf15fe4f8f9376c1f1b95833cdaa79ff`. [Preparation observations](../docs/evidence/milestone-9-preparation.json) are from finalized block 276688114. Recheck current state and fees before execution.

## Actors and wallet

- `yf-operator-261105.testnet`: supporter, guardian and funded-profit controller. It already holds all 1,000,000 tUSD; no extra supporter-funding transfer is needed. This replaces the earlier generic checklist's separate-supporter example.
- `yf-council1-261105.testnet`: proposes the payment and casts the first approval.
- `yf-council2-261105.testnet`: casts the second approval.
- `yf-council3-261105.testnet`: receives the fictional 20 tUSD payment. It does not sign during this sequence.

Use the existing NEAR CLI wallet adapter through HOT Connect 0.12.0 and the existing Windows Credential Manager keys. Browser account selection and live reads were verified; transaction signing through this adapter has not been exercised. Selecting an account ID alone is not proof of signing authority. No keys will be imported into a website or browser storage. All three council accounts remain under the same local user's custody, not independent people.

## Proposed sequence

All amounts below are six-decimal, valueless test tUSD. Contract IDs are fixed in the JSON review and the audited [testnet manifest](testnet.json).

| # | Signer | Action | Required outcome |
| --- | --- | --- | --- |
| 1 | Operator | Register vault position | Operator position exists, zero units |
| 2 | Operator | Deposit 1,000 tUSD | Vault accepts 1,000; operator receives 1,000 nominal units |
| 3 | Operator | Allocate 1,000 to the simulator | Actual tokens and simulator position both equal 1,000 |
| 4 | Operator, external CLI | Fund 30 tUSD profit | Exact `fund_profit` hook accepts 30; position backed by 1,030 |
| 5 | Operator | Redeem the full strategy | Vault has 1,030 cash, 1,000 nominal and 30 eligible yield |
| 6 | Operator | Donate at most 30 | Fixed DAO receives 30; supporter backing remains 1,000 |
| 7 | Council 1 | Propose 20 to council 3 | Exact transfer proposal is InProgress; 0.1 NEAR bond |
| 8 | Council 1 | First approval | Proposal remains InProgress; recipient still has zero |
| 9 | Council 2 | Second approval | Successful token receipt pays 20 once; DAO retains 10 |
| 10 | Operator | Request withdrawal of 200 units, minimum 200 | Request reserves exactly 200 units for the operator |
| 11 | Operator | Advance that withdrawal | Operator receives 200; 800 units and 800 backing remain |

Ten transactions use app reviews and the browser's CLI wallet adapter. The funded-profit call uses external CLI tooling because the app has no controller funding form. Evidence must identify those channels separately. The signed transaction is checked against the exact review and its hash retained; a wallet response alone never establishes success.

Proposal and withdrawal IDs are deliberately receipt-bound references, not guessed numbers. Resolve each only from the preceding matching finalized receipt, re-read its exact on-chain content, and display concrete arguments before signing. No literal placeholder may be sent.

Before a successful transaction, check wallet cancellation/rejection and stale account selection without broadcasting a transaction. Refresh during pending receipt tracking and verify that the same hash is recovered without a duplicate submission. These checks remain unverified until executed; chooser cancellation alone is not transaction rejection evidence.

## Native-token budget

Live storage costs: **0.00512 NEAR** for one position and **0.02048 NEAR + 1 yoctoNEAR** for each permanent operation. Allocation, redemption, donation and withdrawal create four operation records. The proposal attaches **0.1 NEAR**, with no assumed bond refund in the spending limit.

Planned external attachments total **0.187040000000000000000007 NEAR**. The requested attachment ceiling is **0.188 testnet NEAR**, plus a separate **1.25 testnet NEAR gas ceiling** for all 11 transactions and their descendants. This approval is bounded at **1.438 testnet NEAR total**, including the tiny internal token-transfer attachments. Storage charges are not refundable; retain the proposal bond in the budget even if later returned.

At the observed gas price, the conservative per-transaction fee allowance is 0.09 NEAR (300 Tgas × gas price × 3), or 0.99 across 11 transactions. Available native balances cover each actor's planned attachments, its conservative fees, and an additional 1 NEAR reserve. Recompute before signing; stop if the requested ceilings or reserve checks would be exceeded.

Expected final tUSD balances: operator **999,170**, vault **800**, strategy **0**, DAO **10**, council 3 **20**, other councils **0**. Vault nominal units **800**, eligible yield **0**, total donated **30**, no outstanding operation.

## Local enablement and stop conditions

Approval would enable signing only for a local rehearsal session and the reviewed accounts/actions. The committed read-only manifest, ordinary preview and production build remain unchanged. The current `npm run dev:testnet` command explicitly rejects manifests with signing enabled; it cannot silently become a signing session.

Fresh code/config/policy/key checks and receipt verification are mandatory. Stop on changed authority, storage costs, recipient, amount, stale account selection, unsuccessful receipt or unknown outcome. Resolve unknown transactions by exact saved hash; no fresh-transaction retry, extra storage registration or additional payment is included. No redeployment, new access key, mainnet action, publication or submission is included. Loss and callback-fault demonstrations remain in local Sandbox.

[HACKATHON.md](../HACKATHON.md), under “Never without the human's explicit confirmation,” lists **“Sign transactions, spend tokens or deploy to mainnet.”** The prior approval explicitly excluded these application actions. This completed review is the concrete scope for the next approval.

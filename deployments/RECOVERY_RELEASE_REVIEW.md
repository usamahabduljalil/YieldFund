# Recovery v2 testnet release — approval requested

Prepared 14 November 2026. **Approved by the user: "Approve testnet v2 release". Execution in progress.** Mainnet remains deferred. This plan creates a separate demo token and two fresh campaign pairs; it does not upgrade, move funds from, or replay transactions against the historical campaign vaults.

Exact calls, arguments, gas, attachments and normal artifact hashes: [recovery-release.review.json](recovery-release.review.json). Canonical JSON SHA-256: `6d55bbccf4108a7bc6c8ac362c965ac4409b7695f4f122b07803d0aaed75bec5`. [Read-only preflight](../docs/evidence/milestone-16-release-preflight.json) checked account availability, existing DAO code/policies, next proposal IDs and compiled creation cost. Recheck immediately before execution; stop on changed assumptions.

## Accounts and budgets

Create four named testnet accounts through the free faucet, requesting **10 testnet NEAR each** (40 total):

- `yf-v2-token-261114.testnet`: deploy fixed-supply receipt-enabled demo token, retaining its upgrade key.
- `yf-v2-factory-261114.testnet`: deploy factory v2, retaining its upgrade key.
- `yf-v2-demo-261114.testnet`: Commons creator/controller/supporter, initially owns 1,000,000 new tUSD.
- `yf-v2-builder-261114.testnet`: independent Builders creator/controller.

Keys stay outside the repository in local credential storage. These accounts share this machine's custody; they are not independent people or prize addresses. Factory-created vault/strategy children have no access keys. Retained token/factory/DAO authority must remain disclosed.

Exact outer attachments total **18.682970000000000000000007 testnet NEAR**, including the 3 NEAR factory reserve transfer, two creation deposits of **7.6871 NEAR each**, storage/operation payments, seven yoctoNEAR and **0.2 NEAR proposal bonds**. The two bonds use existing council 1 funds. Gas fees across the 20 calls are capped at **0.75 testnet NEAR total**, separately from attachments. Required inner transfers are funded by these deposits or existing reviewed DAO balances; no unlisted top-up or second creation deposit is authorized.

Only the new fixed-supply tUSD is used: 100 tUSD deposited/allocated, 3 tUSD externally funded profit, at most 3 donated, 20 withdrawn, 2 paid by the existing treasury to `yf-council3-261105.testnet`. Old test-token holdings remain separate.

## Twenty transactions

`demo`, `builder`, `token` and `factory` below refer to the four full IDs above. `council1/2` are `yf-council1-261105.testnet` and `yf-council2-261105.testnet`. The treasury is `dao.yf-operator-261105.testnet`; verifier is `yf-verify-261113.testnet`.

| # | Signer | Action | Attached testnet NEAR | Channel |
| --- | --- | --- | --- | --- |
| 1 | token | Atomic token deploy + initialize fixed supply | 0 | CLI |
| 2 | token | Transfer factory storage/reserve funding | 3 | CLI |
| 3 | factory | Atomic factory deploy + initialize | 0 | CLI |
| 4 | demo | Create Commons, cap 1,000 tUSD | 7.6871 | CLI |
| 5 | builder | Create Builder Commons, cap 1,000 tUSD | 7.6871 | Browser wallet |
| 6 | demo | Register Commons position | 0.00512 | Browser wallet |
| 7 | demo | Deposit 100 tUSD | 1 yocto | Browser wallet |
| 8 | demo | Allocate 100 tUSD | 0.02048 + 1 yocto | Browser wallet |
| 9 | demo | Fund simulator with 3 tUSD profit | 1 yocto | CLI |
| 10 | demo | Redeem simulator position | 0.02048 + 1 yocto | Browser wallet |
| 11 | demo | Donate at most 3 tUSD to fixed treasury | 0.02048 + 1 yocto | Browser wallet |
| 12 | demo | Request 20-unit withdrawal, minimum 20 tUSD | 0.02048 + 1 yocto | Browser wallet |
| 13 | demo | Advance withdrawal operation 4 | 1 yocto | Browser wallet |
| 14 | demo | Register council 3 for the new token | 0.02173 | CLI |
| 15 | council1 | Propose treasury payment of 2 tUSD to council 3 | 0.1 bond | CLI |
| 16 | council1 | First payment approval, proposal 1 | 0 | CLI |
| 17 | council2 | Second payment approval, proposal 1 | 0 | CLI |
| 18 | council1 | Propose Commons verification, expires 1 Dec 2026 UTC | 0.1 bond | Browser wallet |
| 19 | council1 | First verification approval, proposal 1 | 0 | Browser wallet |
| 20 | council2 | Second verification approval, proposal 1 | 0 | Browser wallet |

Deployment steps include the exact normal Wasm artifact specified by the JSON plus its initialization action in one transaction. All browser handoffs must match the reviewed call, account, amount, attachment and gas exactly. DAO proposals use 100 Tgas, DAO votes 250 Tgas, other function calls 300 Tgas. Verify proposal kind/content and next ID before submission, then reconcile every finalized receipt tree and actual balances. A hash or top-level success alone does not complete a step.

## Acceptance and public activation

Before the corresponding successful browser transactions, exercise cancellation and stale-account/network review rejection without broadcasting another transaction. Test refresh/receipt recovery against the approved transactions. Cancellation of a connection dialog alone is not transaction cancellation evidence. If the wallet requires a changed call or additional spending, stop and prepare the concrete difference.

Expected final Commons state: 80 tUSD cash/backing and 80 nominal units; no outstanding reservations or strategy position; 20 withdrawn and 3 donated. The new-token treasury balance is 1 tUSD, council 3 receives 2, Commons is DAO verified after two votes, Builders is unverified. Verify both pairs' code/configuration and lack of keys, normal-only artifacts, token registration cost and retained authorities.

After all acceptance checks pass, approval also authorizes updating the public testnet manifests, recording exact acceptance evidence, pushing the verified changes to GitHub and deploying to the existing Vercel project with **testnet signing enabled**. The build guard requires the accepted evidence to match the exact runtime, registry and review digests. It is a review guard, not a substitute for auditing receipts. Do not create an accepted record before the checks actually pass. Mainnet signing stays unavailable.

The v2 token's recovery extension is test infrastructure. Ordinary assets/Rhea do not acquire these methods. Pending token resolver evidence remains locked; no timeout unlock, administrative force-success or invented receipt is authorized. Fault injection artifacts remain local to Sandbox.

## Why another confirmation is required

[HACKATHON.md](../HACKATHON.md) lists **“Sign transactions, spend tokens or deploy to mainnet.”** under **“Never without the human's explicit confirmation.”** All previously approved testnet plans were completed. These are different contract deployments, new accounts and a new bounded rehearsal; the older approvals do not cover these calls. Implementation, local tests, read-only preflight and the review itself do not sign anything.

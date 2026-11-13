# Milestone 8 — approved public testnet setup

6–7 November 2026 (Africa/Lagos). **All 19 approved transactions finalized; public deployment audit passed.** The user explicitly approved the concrete [funding/deployment review](../../deployments/DEPLOYMENT_REVIEW.md) with “testnet actions approved”.

The approved plan SHA-256 is `f4ecd10fb4ee7b85c049a1e8dad4ef587faa30fd30b412e52ede85d7b76550e7`. Its scope is three council-to-operator transfers of 5 testnet NEAR, four contract creations, four atomic deployment/initialization transactions, and eight token-storage registrations. Setup attachments are bounded at 22.16 NEAR and the separate total gas allowance is 2 NEAR.

## Preflight and execution procedure

- [Before funding](milestone-8-preflight-before.json): exact normal artifact hashes and actor public keys matched; all contract accounts were absent; operator funding was the only blocker.
- [After funding](milestone-8-preflight-funded.json): all three top-ups finalized, operator balance was 25 NEAR, all actor keys still matched milestone 6, and the funding preflight passed at block 276548492.
- NEAR CLI 0.30.1 signs with the actors' Windows Credential Manager entries or the reviewed contract credential files outside this repository. No private key is passed in process arguments or saved in evidence.
- Each signed transaction is saved locally before broadcast. Its Borsh-encoded signer, public key, receiver, ordered actions, arguments, gas, attached deposits and deployed Wasm hash are compared with the reviewed step. The ed25519 signature and transaction hash are verified before sending.
- The transaction hash is journaled before `send_tx` with `wait_until: FINAL`. A network error after that point requires lookup of that exact hash, without blindly signing or broadcasting a replacement.
- Each finalized result is retained in [the receipt directory](milestone-8-receipts/). Successful root and descendant outcomes, complete reachable receipt trees and cumulative `tokens_burnt` are checked before advancing. The gas budget includes all 19 transactions.
- An RPC connection reset during a read-only precheck was retried before signing the second top-up; it did not trigger a duplicate transfer.
- The original `rpc.testnet.near.org` endpoint returned HTTP 429 with a deprecation notice and a `Retry-After` value. Execution moved to `https://test.rpc.fastnear.com`, listed by [NEAR's RPC provider documentation](https://docs.near.org/api/rpc/providers), after verifying its testnet identity and freshness. The approved plan, amounts, contracts, keys and encoded actions were preserved. The CLI's signing reads use its configured FASTNEAR archival endpoint.
- DAO creation and strategy initialization each had an interrupted first submission. Exact hash lookup returned `UNKNOWN_TRANSACTION`; finalized state showed the DAO absent / strategy without code and each signing nonce unused. Only then were the identical signed bytes submitted, without generating replacement transactions. Both finalized once. Recovery observations: [DAO creation](milestone-8-dao-creation-recovery.json), [strategy initialization](milestone-8-strategy-initialization-recovery.json).
- The CLI process timed out after saving the strategy's signed transaction. That saved file passed the independent decoder/signature checks and was used directly; the deployment was not signed twice.
- The last council registration also timed out without a known transaction. Its nonce remained unused and token registration was absent. An identical-byte asynchronous submission through the replacement endpoint did not produce a known transaction; the same bytes were then submitted through the CLI's verified FASTNEAR archival endpoint using `broadcast_tx_commit`. Subsequent hash lookup confirmed `FINAL`. [Recovery checks](milestone-8-last-registration-recovery.json), [archival attempt journal](milestone-8-last-registration-broadcast.json). There is one finalized hash for that action and 19 distinct finalized hashes overall.

## Completion evidence

The [execution report](milestone-8-execution.json) independently compares all RPC-reported transactions to the approved actions, checks complete successful receipt trees, and reconciles finalized native/token balances and all eight public-key lists. It includes every transaction hash and exact fee amount. All four normal artifact hashes match the deployment receipts and live account code hashes.

| Role | Deployed contract | Atomic deployment/initialization hash |
| --- | --- | --- |
| Vault | `vault.yf-operator-261105.testnet` | `91RFQNrfbJwCjziQjKWRPXMSm6V6ppkoV97hdXS2Jefy` |
| Token | `token.yf-operator-261105.testnet` | `7wW2Xyt7Kz1NtJyWpRgzE4gcKY6bHWoBgBRLkvqAmKrW` |
| Funded simulator | `strategy.yf-operator-261105.testnet` | `DeZxQRV32fZX1wdDmxxoEqodtGinHczLk34HCkdZLoQ` |
| Sputnik DAO | `dao.yf-operator-261105.testnet` | `2H9VxPuJ99K3oexRo5DaaJ7JQyEVBJU6UFhoZv6Ey1mk` |

- Contract funding: **22 NEAR**. Storage attachments: **0.16 NEAR**; **0.15125 NEAR refunded**, **0.00875 NEAR retained** for seven new token registrations. The operator was already registered at token initialization and received its full 0.02 attachment back.
- Total recorded transaction/receipt `tokens_burnt`: **0.0411723816874521 NEAR**, below the **2 NEAR** allowance. This exactly matches the aggregate native balance reduction across the eight accounts from their initial combined 40 NEAR.
- Operator balance: **2.9608525013069606 NEAR**, including its native storage reserve. Each council retains **4.9999553634875 NEAR**. Every contract retains more than 1 NEAR available after its measured native storage requirement. Full balances and storage costs are in the execution report at block **276582913**.
- All **1,000,000 tUSD** remain with the operator/controller; the seven other accounts hold zero. Vault nominal units, backing, eligible yield and donated total are zero; no operation is active or queued.
- [Read-only audit](milestone-8-audit.json) passed at block **276582916**, hash `2avWEVpxwqFPncRnRx4cZHFZE9GzHrR6wYDaedJ5Uhyo`. It checked configuration, token metadata/supply/registration, simulator binding, three-member/two-approval transfer-only DAO policy, factory settings, code and retained keys.
- [Read-only manifest](../../deployments/testnet.json) uses the replacement RPC; it otherwise matches the approved manifest and has `transactionsEnabled: false`. The original approved plan/hash is preserved. The default app still uses preview.

## Tooling verification

Added an explicit optional RPC argument for read-only `audit`, `accounts` and `preflight`. It rejects non-HTTPS URLs, credentials, query strings, fragments and broadcast methods. Reports identify both original and effective endpoints; the approved plan is not rewritten. Live audit command:

```sh
npm run deployment -- audit deployments/testnet-plan.review.json artifacts/testnet-audit-current.json https://test.rpc.fastnear.com
```

`npm test`: **82 passed**, one optional live Sandbox test skipped. Typecheck and formatting checks passed. No UI or Rust contract source changed, so their previous visual/Sandbox evidence was not rerun or relabeled as new. Public wallet rehearsal is still pending.

## Boundaries

The deployment uses the normal funded simulator, not live Rhea lending or fault/control artifacts. tUSD has six decimals and no monetary value. All operator/council keys remain controlled from the same Windows account; the three council accounts are not independently controlled people. Four retained full-access contract keys can replace contract code. DAO factory is itself with auto-update enabled.

Application deposits, allocation, funded profit, donation, DAO payments, browser signing enablement, publication and submission are excluded from this approval. The app remains in preview and the testnet manifest remains read-only. Public wallet behavior and final AC01–AC12 sign-off remain pending. Unknown outgoing payment/allocation and simulator-internal finalizer recovery remain unresolved.

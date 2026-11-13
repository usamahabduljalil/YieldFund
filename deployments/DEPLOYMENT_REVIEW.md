# YieldFund testnet deployment review

Prepared 5 November 2026. **Approved by the user on November 6 and executed November 6–7.** All 19 transactions finalized and the public deployment audit passed. [Execution evidence](../docs/evidence/milestone-8.md). The proposal and its original funding observations below are retained as the approved historical review; they are not current balances or instructions to rerun setup.

The exact actions and arguments are in [testnet-plan.review.json](testnet-plan.review.json), generated from [testnet-input.review.json](testnet-input.review.json). The proposed native-token transfers are in [testnet-funding.review.json](testnet-funding.review.json). Both are bound to plan SHA-256 `f4ecd10fb4ee7b85c049a1e8dad4ef587faa30fd30b412e52ede85d7b76550e7` (canonical JSON).

## Proposed actions

1. Transfer **5 testnet NEAR from each** of `yf-council1-261105.testnet`, `yf-council2-261105.testnet` and `yf-council3-261105.testnet` to `yf-operator-261105.testnet`: **15 total**, plus transfer gas. Each council currently has 10 and would retain approximately 5 before gas.
2. From the operator, create the four child accounts below with their distinct reviewed public keys and retained full-access permission.
3. Deploy the pinned normal Wasm and initialize each contract atomically in one self-signed transaction. Initialize token, strategy, vault, then the existing pinned Sputnik DAO. No test-fault or simulator-control build is included.
4. Register the eight unique contract/operator/council accounts with the test token, using at most 0.02 NEAR each. Token storage refunds reduce the actual cost.
5. Verify finalized receipts and run the read-only deployment audit. Keep browser signing disabled until a separate wallet rehearsal.

| Contract | Account | Funding | Storage, initialization gas and reserve estimate |
| --- | --- | --- | --- |
| Vault | `vault.yf-operator-261105.testnet` | 6 NEAR | 5.56503 NEAR |
| Token | `token.yf-operator-261105.testnet` | 5 NEAR | 4.29961 NEAR |
| Strategy | `strategy.yf-operator-261105.testnet` | 4 NEAR | 3.94284 NEAR |
| DAO | `dao.yf-operator-261105.testnet` | 7 NEAR | 6.69983 NEAR |

Contract funding totals **22 NEAR**; registration attachments add at most **0.16 NEAR**. The proposed gas allowance across the three top-ups, creation, initialization and registration is **2 testnet NEAR**. Recheck pricing and balances before signing; stop if the estimated total exceeds that allowance. This is a ceiling for the proposed execution, not a claim of actual fees spent. Initialization gas comes from the newly funded contract balances.

The operator needs **24.24 NEAR available** under the conservative preflight calculation, including 22.16 in attached deposits, 1.08 in operator gas allowance and a 1 NEAR operating reserve. It currently has 9.99818 available after existing storage, leaving **14.24182 NEAR short**. The three proposed top-ups provide 15 NEAR. Council balances are not counted as operator funds until transfers finalize.

## Fixed configuration and custody

- Campaign: fictional Commons campaign, six-decimal tUSD, 10,000-token deposit cap; 1,000,000 fixed test tokens initially held by the operator/controller. The token has no monetary value.
- Guardian and funded-profit controller: operator. Rehearsal payment recipient: council 3. Normal-build inactive loss-sink binding: council 2. These are explicitly proposed test fixtures; no payment to either account is part of this deployment.
- DAO: the three council accounts, two approvals, transfer-only policy, 0.1 NEAR proposal bond, seven-day expiry. Its factory is itself with auto-update enabled.
- Operator/council keys remain in the current user's Windows Credential Manager. The four contract keys were generated locally with the pinned NEAR CLI, using `fund-later use-auto-generation save-to-folder`; this did not create or fund their implicit addresses.
- Contract credential files are in `C:\Users\usama\AppData\Local\YieldFund\testnet-contract-keys-20261105`, with inheritance disabled and FullControl granted only to the current Windows user. The exact mapping is in ignored `artifacts/testnet-key-locations.json`. Never copy the key files into the repository or terminal output.
- All keys are on one machine. This is not independent council custody. Retained full-access keys can replace contract code despite application-level restrictions.

## Evidence and execution boundary

The [latest preflight](../docs/evidence/milestone-7-preflight-final.json) verifies the current code artifacts, network, account existence/absence, actor public keys and funding estimates at a finalized block. All four proposed contract accounts are absent; all actor keys match the milestone 6 creation evidence. The only current preflight blocker is operator funding.

The native-token faucet limited requests to 2 NEAR. One compliant 2 NEAR request returned an error; subsequent finalized state still showed 10 NEAR for the operator. No additional faucet request or council transfer was made. [Faucet error screenshot](../docs/evidence/screenshots/testnet-faucet-error.png).

After approval, execute bounded steps and save each hash before proceeding. A timeout is an unknown outcome: check the exact hash and finalized account state before retrying. Contract `DeployContract` and `new` must remain in one ordered transaction. The pinned CLI supports `with-init-call ... file-args ...`, which avoids shell JSON quoting; use protected access-key files for contract signing without putting secret values in arguments.

This review excludes mainnet, deposits, lending allocation, funded-profit injection, yield donation, DAO proposal payments, browser signing enablement, publication and submission. Those remain separate work.

[HACKATHON.md, lines 52–58](../HACKATHON.md) requires human explicit confirmation for: “Sign transactions, spend tokens or deploy to mainnet.” The user's “testnet actions approved” authorized this concrete funding/deployment plan. It is now complete; the excluded wallet rehearsal and application transactions remain separate.

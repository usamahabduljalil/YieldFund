# Expanded testnet campaign release

Prepared 13 November 2026. Mainnet is excluded. Exact calls are in [campaign-release.review.json](campaign-release.review.json), canonical SHA-256 `4ae0e4e31e1bd86a94bd1e2a6f0283e67eaa0e96afd25f2cf0151a40fb84c7ad`.

Three new testnet accounts were created through the CLI faucet, each funded with 10 free testnet NEAR. Keys are in Windows Credential Manager; no secrets are committed. [Public account evidence](../docs/evidence/milestone-15-accounts.json).

| Step | Signer | Result / attached amount |
| --- | --- | --- |
| Deploy and initialize verification DAO | `yf-verify-261113.testnet` | Pinned Sputnik Wasm; existing three council members, two approvals; function-call permission only. No attached deposit. Code storage reserves approximately 4.95 testnet NEAR. |
| Deploy and initialize factory | `yf-factory-261113.testnet` | Pinned normal vault/simulator templates and existing test token; verifier above. No attached deposit. Code storage reserves approximately 9.10 testnet NEAR. |
| Fund second creator | Verification account → `yf-operator-261105.testnet` | Transfer 4.5 testnet NEAR from the new faucet-funded account. Retain storage reserve and gas. |
| Create Garden | `yf-creator-261113.testnet` | Attach exactly 7.23522 testnet NEAR. Fixed existing testnet DAO, 1,000 tUSD cap. |
| Create Builders | `yf-operator-261105.testnet` | Attach exactly 7.23522 testnet NEAR. Same fixed DAO, separate keyless vault and simulator, 1,000 tUSD cap. |
| Propose Garden verification | Council 1 | Attach 0.1 testnet NEAR proposal bond. Immutable metadata/evidence hash; expires 1 December 2026 UTC. |
| Vote once, then twice | Council 1, council 2 | No attachment. First vote must leave Garden unverified; second executes the exact factory call. Builders stays unverified. |

Gas allowance is **0.5 testnet NEAR total** across these eight steps; actual fees are recorded and remaining steps stop if the cap cannot be maintained. Creation attachments total **14.47044 testnet NEAR**. The 4.5 transfer moves existing faucet funds; it is not additional funding. DAO execution attaches 1 yoctoNEAR from its balance. No token deposit, allocation, profit, withdrawal, donation or payment from the historical Commons vault is included.

Before each step: verify testnet, freshness, signer keys, exact artifacts, funding and previous finalized receipts. Save each signed payload and its hash before broadcast. On interruption, query the same hash; never sign or replay an uncertain step automatically. Verify all nested receipts and current child/registry state before publishing configuration.

Factory and verifier retain full-access deployment keys, disclosed in the release. New vault/strategy children have no access keys. Unknown payment callbacks and partial factory creation remain fail-closed limitations; this release uses test tokens only and is not a production-money launch. The original eleven-call rehearsal approval is exhausted and will not be replayed.

The user explicitly approved this expanded eight-step plan, then the separate funding correction in CAMPAIGN_FUNDING_CORRECTION.md. All nine unique transactions finalized; see docs/evidence/milestone-15-execution.json. Both approvals are exhausted and must not be replayed. Website publication remains authorized separately.

# Campaign factory and initial release preparation

13 November 2026. Scope: permissionless creation and DAO verification contracts, campaign-safe Activity persistence, read-only mainnet discovery and publication preparation.

## Verified

- Ten factory unit tests pass: distinct creators/children, no AddKey actions, creation/registration state, failure and stale callbacks, duplicate IDs, pagination/validation, DAO-only verification/revocation, metadata binding and expiry.
- Real Sandbox 2.14.0 test `campaigns::permissionless_campaigns_and_dao_verification` passes. Alice and Bob each pay the exact creation cost, deploy separate keyless vault/strategy children, register positions and deposit 100/200 test tokens. Raw access-key queries confirm no child keys. Balances stay separate. Underfunding and duplicate IDs are rejected.
- The actual pinned Sputnik DAO executes the verification function call after two different member approvals. Neither the creator nor an individual member can verify directly; one vote leaves the campaign unverified. Beta stays unverified. Finalized receipt evidence: [campaign-factory-sandbox.json](campaign-factory-sandbox.json).
- Normal vault SHA-256: `1956c598503bcf2b0730180eb64b87bb9f048250ae73dec07f0694d9be2ff3b1`; simulator: `3ccbe4e4389f412bc31c5869c42ba74710420b288c40c7c57414dd44cbd81348`; factory: `ffb6464f6ed462c183e8af7572ea24ff4bfbe65fc92086f786409b30833baa21`. Historical deployed vault/simulator hashes are unchanged in the public testnet manifest and separate reviewed fixtures.
- TypeScript at the factory checkpoint: 122 pass, one optional local Sandbox skip. Three new persistence tests preserve other scopes, retain unresolved rows and reject mixed scopes/corrupt data without overwriting it. Historical artifact-dependent tests now run in clean checkouts against hash-checked fixtures.
- `npm run build:host` passes, including type checking. Four Sites packaging tests pass. The hosted build uses live public testnet reads with signing disabled. Local browser shows 800 capital units/cash, 30 DAO funding, 10 treasury balance and four completed operations at block 277457182; no wallet needed.

## Mainnet evidence and cap

[Read-only discovery](mainnet-discovery.json) checked mainnet block 224267966. Rhea code account/config, wrapped NEAR metadata/asset, operator position and protocol config responded. The supplied mainnet account returned UNKNOWN_ACCOUNT. No key was accessed and no transaction was signed/broadcast.

At the observed storage price of 0.00001 NEAR per byte, current normal vault code (386,222 bytes) and simulator code (224,637) alone reserve 6.10859 NEAR. Factory code is 910,144 bytes, another 9.10144 NEAR. Sputnik code adds 4.95447 NEAR if deployed conventionally. These are code-only storage figures, excluding state, child operating reserves, token storage and gas; they exceed the user's total 5 NEAR cap. The measured Sandbox per-campaign creation attachment is 7.23522 NEAR, excluding factory/DAO deployment and gas.

## Still incomplete

Public factory deployment and browser creation/selection/verification proposals; mainnet wallet network/precision support; actual Rhea supply-only adapter and funded lifecycle; actual Trezu discovery/proposal/payment rehearsal; partial factory creation repair/refunds; unknown outgoing-operation recovery; live wallet rejection and switch acceptance. Do not describe this milestone as a finished mainnet or multiple-campaign product.

The complete contract regression subsequently passed in GitHub CI run 43396632842: 32 unit tests, 14 Sandbox scenarios, one ignored fixture generator. Publication and subsequent browser/client work are recorded in [milestone 14](milestone-14-public-release.md). No historical eleven-call testnet action was replayed.

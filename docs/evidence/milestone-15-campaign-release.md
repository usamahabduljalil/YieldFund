# Multi-campaign testnet release

13 November 2026. Mainnet deployment is deferred at the user's request. This milestone adds real testnet factory campaigns and verification governance, client flows and a manual submission kit.

## Chain evidence

The user approved the exact [eight-step plan](../../deployments/CAMPAIGN_RELEASE_REVIEW.md), then the [0.2 NEAR funding correction](../../deployments/CAMPAIGN_FUNDING_CORRECTION.md). All **nine unique transactions** finalized successfully; [execution index](milestone-15-execution.json) links their exact hashes, fees and receipt counts. Total burned fees: **0.0584708461110246 testnet NEAR**, below the unchanged 0.5 cap. No mainnet funds or historical Commons tokens moved.

- Factory: `yf-factory-261113.testnet`; verifier: `yf-verify-261113.testnet`. Both retained full-access keys, held in this machine's keychain, are disclosed deployment authority.
- Garden creator: `yf-creator-261113.testnet`; Builders creator: `yf-operator-261105.testnet`. Two different creators, separate `v-ID`/`s-ID` children, pinned normal code, **zero child access keys**, immutable treasury/metadata/token/cap and final `ready` states verified.
- Both campaigns use the fixed six-decimal test token and the existing beneficiary DAO, with 1,000 tUSD caps. Both are initially empty; the public release did not deposit into them. Sandbox separately proves isolated 100/200 deposits.
- Verification DAO is pinned Sputnik with three council members, two approvals and function-call permissions. Treasury payment policy is unchanged.
- [First-vote audit](milestone-15-receipts/vote-1.audit.json): proposal InProgress; both campaigns unverified.
- [Second-vote audit](milestone-15-receipts/vote-2.audit.json): proposal Approved, Garden attestation matches exact metadata/evidence and expires 1 December 2026 UTC; Builders remains unverified. Final audit block **277570993**.

Builders' first broadcast was rejected at admission for insufficient prepaid gas reserve. [Read-only rejection evidence](milestone-15-builders-rejection.json) confirmed an unknown hash, unused nonce and absent campaign. After the separately approved 0.2 NEAR transfer, the **same signed bytes/hash** finalized once. The sender preflight now retains a conservative 10× current gas-price reserve plus overhead; this is available-balance headroom, not a fee quote. No duplicate campaign was created and no uncertain transaction was automatically replayed.

Execution used CLI keychain signing and an independently decoded/verified transaction before broadcast. These are not browser-wallet handoff observations. Public receipt files contain no private keys; signed payload files stay under ignored `artifacts/`.

## Implementation and checks

- Registry selection builds a fresh runtime from exact campaign/vault bindings, token/DAO code hashes and keyless children. Chain providers remount by network/vault; session selection and direct campaign links survive reload.
- Creation review binds immutable canonical metadata, exact current funding cost, current wallet session and exact-ID availability. Persist-before-wallet submissions support unknown hashes, explicit rejection, receipt recovery and ready-state verification.
- Verification/revocation proposals and approve/reject/finalize reviews use fresh policy/proposal/campaign reads and exact factory actions. A finalized DAO proposal alone is not interpreted as a verified badge; registry attestation state is authoritative.
- Stale draft preparation and network/campaign switching invalidate results. Registry history is scoped and preserves unresolved entries. A reproduced gas-funding rejection is now a regression case.
- **163 TypeScript tests passed, one optional Sandbox skip**. Typecheck, hosted production build and **four packaging checks passed**. Contracts are unchanged from the reviewed artifacts; previous full CI run 43469690634 passed 32 Rust units and 14 Sandbox scenarios, one fixture generator ignored.
- Local browser verified actual directory records, Garden selection and direct-link reload against public RPC, plus Approved verification proposal #0 with two votes. Intermittent provider responses omitted CORS headers; errors were displayed honestly and refresh recovered. Registry and vault clients now share one paced read budget instead of multiplying concurrency across panels. Final hosted checks and screenshots are recorded below after publication.

## Release boundaries

The hosted manifest and registry remain read-only. Partial factory creation repair/refunds and unknown outgoing callback outcomes remain unsupported; unresolved state stays locked. Do not advertise unrestricted public deposits or complete P0 recovery. New browser signing controls are implemented and tested with controlled adapters, while a full live-wallet registry acceptance run remains incomplete.

Mainnet deployment, general token precision, real Rhea adapter/lifecycle and Trezu interoperability remain incomplete/deferred. Sputnik governance is separately implemented. This release does not convert funded simulated profit into a real-yield claim.

Original code uses the user's selected all-rights-reserved license; third-party licenses are preserved. The user handles the demo post and final submission. [Manual kit](../MANUAL_SUBMISSION.md), [demo walkthrough](../DEMO_WALKTHROUGH.md).

## Public delivery

Publication and final browser evidence pending at this checkpoint; do not infer publication from a local build.

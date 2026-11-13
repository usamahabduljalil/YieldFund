# Testnet preparation

The approved public testnet setup is complete and audited. [Milestone 8](../docs/evidence/milestone-8.md) contains contract IDs, finalized receipts, balances and authority evidence. [testnet.json](testnet.json) is the read-only runtime manifest. The MVP uses the funded simulator after the November 4 Rhea evidence gate; Rhea and Trezu remain unverified. `testnet-input.example.json` deliberately contains null account IDs and keys and is not deployable.

The executed review is [DEPLOYMENT_REVIEW.md](DEPLOYMENT_REVIEW.md), [testnet-input.review.json](testnet-input.review.json) and [testnet-plan.review.json](testnet-plan.review.json). These preserve the exact approved plan; do not rerun its creation/initialization steps. The older `testnet-input.draft.json` is retained as the incomplete milestone 6 draft.

`testnet-actors.json` records the fresh operator/council account names requested on November 5. The previously supplied implicit IDs were discarded at the user's request. Recheck their existence with:

```sh
npm run deployment -- accounts deployments/testnet-actors.json artifacts/testnet-accounts-current.json https://test.rpc.fastnear.com
```

This writes finalized public account observations. Exit 2 means at least one account has conclusive `UNKNOWN_ACCOUNT` evidence; network/RPC failures are errors, not evidence of account absence. An account can exist without enough available balance for deployment. Actor key custody and actual account creation evidence are documented in [milestone 6](../docs/evidence/milestone-6.md).

## Generate an unsigned setup plan

Build the reviewed normal artifacts using the Linux/WSL instructions in [contracts/README.md](../contracts/README.md), including `scripts/build-dao.sh`. Then, from the repository root:

```sh
npm run deployment -- artifacts
```

This checks all four Wasm files against the milestone 5 hashes pinned in `scripts/deployment.mjs`. Fault-injection and simulator-control artifacts are excluded. A future contract change requires fresh contract evidence and an explicit hash update.

Copy `testnet-input.example.json` to an ignored `artifacts/testnet-input.json`. Fill in:

- An operator and a named `.testnet` deployer account (these may be the same). Four **new, direct child** contract IDs belong under the deployer, each with a public ed25519 key. For example, the structural pattern is `vault.<deployer>.testnet`; this is not an allocated account. Operator, guardian and council identities may also be 64-character implicit accounts. A separate named deployer avoids the 64-character account-ID limit when creating contract children; see [NEAR account IDs](https://docs.near.org/protocol/accounts-contracts/account-id).
- Existing guardian, funded-profit controller, loss-sink, payment recipient and three distinct council account IDs. Actors may overlap where appropriate, but cannot be contract accounts. Distinct council IDs do not establish independent human control.
- A plain-language authority statement identifying who retains each deployment key and who controls the actor accounts. Never put seed phrases, private keys, credentials or wallet exports into the input.
- Campaign metadata, deposit cap and fixed token supply, expressed as six-decimal base-unit strings. Defaults are a 10,000-token cap and 1,000,000-token test supply; all supply is assigned to the controller at initialization.

```sh
npm run deployment -- plan artifacts/testnet-input.json artifacts/testnet-plan.json
```

The output contains exact initialization arguments, ordered unsigned transactions, public-key expectations, metadata hash, policy, and a read-only frontend manifest. It is a review document, not a transaction executor. Output files use exclusive creation and cannot overwrite existing evidence. Use a new filename for each revision. The input metadata hash is SHA-256 over the emitted UTF-8 `metadataCanonical` string, without a trailing newline.

The current plan allocates 6/5/4/7 testnet NEAR to vault/token/strategy/DAO, each with a retained full-access key. These keys can replace code and change custody despite the contract-level rules. DAO initialization is signed by the DAO account itself: its factory is itself and `auto_update` is true. This configuration is matched by the audit, not described as immutable. The transfer-only council policy provides three members and two approvals, with a 0.1 NEAR proposal bond and seven-day expiry.

Deployment and `new` are an **ordered pair in one self-signed transaction**, avoiding an uninitialized deployed contract between transactions. The plan registers contract and rehearsal accounts with the token, attaching 0.02 NEAR each; unused storage deposits are refundable by the token. The total attached-deposit upper bound includes 22 NEAR of contract funding and those registration deposits (22.16 NEAR for the current eight unique accounts). Gas is additional. These are rehearsal allocations, not current fee quotations. Actor accounts need their own gas/storage/bond funding for later wallet actions.

Before executing any plan, check finalized account state: all actors must exist; all four contract accounts must be absent. Verify available native balances and account/key custody. Review the exact plan and obtain the required signing/spending authorization under [HACKATHON.md](../HACKATHON.md). No signing tool is included here. Never retry an unknown transaction merely because it timed out. Record the hash and resolve its finalized outcome first.

## Preflight new deployments and audit existing ones

Before a new deployment, run a fresh read-only funding/existence check using its reviewed plan. The completed deployment's plan now correctly fails preflight because its contract accounts exist:

```sh
npm run deployment -- preflight deployments/testnet-plan.review.json artifacts/testnet-preflight-current.json https://test.rpc.fastnear.com
```

Preflight verifies local artifact hashes, exact unsigned plan, current testnet protocol costs, fresh finalized actor/key state and conclusive absence of contract accounts. The report separates operator spending from contract storage/initialization reserves, and does not count council or staked balances as deployer funds. Any blocker returns a nonzero exit after saving the report; inconclusive RPC failures produce no success report. A passing preflight is readiness for human review, not signing authorization. Protocol reads follow [NEAR RPC documentation](https://docs.near.org/api/rpc/protocol).

After authorized deployment and token registration, run:

```sh
npm run deployment -- audit artifacts/testnet-plan.json artifacts/testnet-audit.json
```

For the completed deployment, use the current RPC endpoint explicitly:

```sh
npm run deployment -- audit deployments/testnet-plan.review.json artifacts/testnet-audit-current.json https://test.rpc.fastnear.com
```

The original endpoint returned a deprecation notice during execution. Optional RPC replacement is supported only for read-only `audit`, `accounts` and `preflight`; it preserves the reviewed plan and hash, still verifies testnet/finalized state, and records original/effective endpoints in the report. Credentials, query strings, fragments, non-HTTPS endpoints and broadcast methods are rejected. The runtime manifest changes only the RPC URL and keeps transactions disabled.

The audit reconstructs the plan from its setup fields and refuses altered actions or configuration. It uses the frontend's finalized snapshot checks for network, freshness, exact code hashes, vault config, token metadata, simulator binding, DAO policy and factory. At that same block it checks all four exact access-key lists, actor existence, token registration, total supply and absence of unresolved operations. Errors produce a nonzero exit and no success report. It never broadcasts, loads wallet credentials, changes `deployment.json`, or enables transactions.

RPC access-key queries and account reads follow the [NEAR account/contract RPC documentation](https://docs.near.org/api/rpc/contracts). The key-list query deliberately omits pagination: the documented more-than-100-keys error fails this four-single-key setup closed. Nonces are ignored when comparing authority; public keys and permissions must match exactly.

Retain deployment and initialization receipts separately. The current strategy view does not expose the controller and loss-sink fields; the audit cannot independently inspect those bindings. Receipt evidence must establish that the reviewed `new` arguments were executed on the reviewed code. An audit records one RPC's finalized observations at a time, not permanent authority or independent consensus verification. Repeat it before a signing rehearsal and after any authority/configuration change.

## Wallet rehearsal

Use [the wallet rehearsal record](../docs/evidence/wallet-rehearsal.md). Leave the default application in preview and the generated manifest read-only until the deployment/authority review and signing authorization are complete. Copying a success report does not enable signing. The existing `transactionsEnabled` configuration switch is a separate reviewed action; no automatic promotion is implemented.

Normal testnet artifacts support funded profit, redemption, donation and healthy withdrawal. Loss, freeze and injected callback-failure scenarios remain in isolated local Sandbox control artifacts, with retained evidence. Do not replace the normal public strategy with the controls build to perform those tests.

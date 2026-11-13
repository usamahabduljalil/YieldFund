# Milestone 6 — deployment preparation and testnet actors

5 November 2026, Africa/Lagos. Deployment tooling is implemented and tested. Four public testnet actor accounts were created following the user's explicit request to replace the supplied implicit IDs. No YieldFund contract was deployed to a public network and no user-wallet application transaction was executed.

## Implemented

- `scripts/deployment.mjs`: checks four reviewed normal Wasm hashes, generates an exact unsigned setup plan, reconstructs plans to reject changed instructions, and audits deployed code/config/policy/keys/registration at a finalized block. Never enables signing or broadcasts. Existing output files are protected from overwrite.
- Separate operator and named deployer roles support both implicit and named actor accounts. The public input template stays deliberately incomplete. `deployments/testnet-input.draft.json` uses the new accounts and proposed contract children, with missing contract keys, recipient, loss sink and custody statement left null.
- `accounts` command records finalized actor existence. A network error is not interpreted as account absence. `testnet-actors.json` contains only the replacement account IDs; the discarded IDs are not used.
- Public wallet rehearsal checklist covers rejection, account/network changes, persisted submissions, actual 1,000 + 30 funded profit, 30 donation, two-vote 20-token payment and healthy 200-unit exit. All public-wallet checks remain pending.
- The November 4 Rhea evidence gate passed without a verified complete lifecycle. The funded simulator is the MVP baseline. This is a scope decision, not proof that Rhea is incompatible.

## Account creation and custody

| Role | Account | Finalized balance |
| --- | --- | --- |
| Operator / proposed deployer | `yf-operator-261105.testnet` | 10 testnet NEAR |
| Council 1 | `yf-council1-261105.testnet` | 10 testnet NEAR |
| Council 2 | `yf-council2-261105.testnet` | 10 testnet NEAR |
| Council 3 | `yf-council3-261105.testnet` | 10 testnet NEAR |

Verified at block **276321550**, hash `BPRfBHUspbj5J4g6s1Z95fapEQSKxEgPv8scDkinhfar`, through `https://rpc.testnet.near.org`. Exact account responses are retained in [account observations](milestone-6-accounts.json); public access-key lists and three finalized council-creation transactions are retained in [authority evidence](milestone-6-account-authority.json). Each account has exactly one matching full-access ed25519 key and no contract code.

Creation used `near-cli-rs@0.30.1` with `sponsor-by-faucet-service ... autogenerate-new-keypair save-to-keychain network-config testnet create`. Private keys were saved in the current Windows user's Credential Manager by NEAR CLI. No private key, seed phrase or wallet export was printed or saved in this repository. Use NEAR CLI's keychain support on this Windows user profile for later authorized actions; wallet import remains a separate local user step. All four keys are currently held on one machine: three council accounts do **not** establish three independent people.

The operator faucet call returned a client/network error after the account was created. Its original creation hash was not returned. A duplicate same-name/same-public-key request was rejected with `AccountAlreadyExists`; it did not add funding. The operator is verified by finalized account state, 10 NEAR balance, and its matching on-chain key, not a claimed successful duplicate receipt. This illustrates why transport failure cannot be equated with transaction failure.

The user's explicit account-creation authorization covered these faucet-funded actor accounts. It is not recorded as authorization to deploy contracts, consolidate council funds, perform app payments, publish or submit. The operator's 10 NEAR is below the plan's 40 NEAR plus registration/gas funding allowance; no deployment funding transfer was made.

## Checks

| Check | Result |
| --- | --- |
| `npm test` | 60 passed, 1 optional live Sandbox test skipped |
| Deployment tests | 26 passing cases including implicit actors, altered instructions, unexpected authority, missing registration, supply mismatch, unknown operations, modified artifacts and account readiness |
| Real CLI smoke | Normal artifacts verified; unsigned plan generated from explicit fixtures; overwrite and invalid input rejected |
| `npm run deployment -- artifacts` | All four normal milestone 5 hashes match local Wasm |
| `npm run build` | Typecheck and production build passed |
| `npm run test:sites` | 4 packaging tests passed |
| Public account observations | All four exist, each 10 NEAR, exact retained public keys verified at one finalized block |
| Public contract audit / wallet signing | Not executed; contracts not deployed |

Authority-audit tests use mocked RPC responses and the already-tested chain snapshot client. They are not public deployment acceptance. No Rust contracts or UI components changed in this milestone, so the contract suite and browser visual review were not repeated. Historical milestone 5 evidence remains applicable to the unchanged Wasm files.

## Remaining work

Complete the draft's four contract public keys, recipient/loss-sink choice and custody statement; generate and review an unsigned plan; arrange sufficient testnet deployment funding; then perform explicitly authorized fresh deployments and receipt-backed initialization checks. Run the public authority audit and wallet rehearsal. Unknown outgoing payment/allocation and simulator-internal callback failures still require further recovery work before public deposits. AC01–AC12 final acceptance remains open.

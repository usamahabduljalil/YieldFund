# Frontend chain mode

The application has two explicit modes. `apps/web/public/deployment.json` defaults to `{ "mode": "preview" }`. Preview actions only change local example data. Missing or invalid configuration fails closed rather than silently becoming preview. The landing page does not load a wallet connector or read deployment state.

Chain mode loads a same-origin JSON manifest selected by `VITE_DEPLOYMENT_URL`. The typed shape is `Deployment` in `packages/near-client/src/chain.ts`. It includes network/chain ID, RPC URL, fixed vault configuration, SHA-256 code hashes for all four contracts, exact DAO policy, factory upgrade settings, transaction enablement and an authority disclosure. The fixture manifest in `docs/evidence/milestone-4-fixtures/` is historical evidence, not a public deployment configuration.

## Reproduce the local read-only demo

First build the milestone 3 Wasm artifacts using `bash scripts/test-contracts.sh` as documented in the contract README. In Linux/WSL, from the repository root:

```sh
# Optional WSL cache; use a Linux path appropriate to your machine.
export CARGO_TARGET_DIR="$HOME/.cache/yieldfund-near/target"
bash scripts/serve-browser-fixture.sh
```

The ignored fixture test deploys actual contracts into an ephemeral loopback Sandbox, funds 1,000 units, adds 30 tokens of funded simulated profit, redeems, donates 30 and executes a 20-token DAO payment through two distinct members. It leaves the network running and writes `apps/web/public/deployment.local.json` and `artifacts/browser-deployment.json`. No secret keys are written to these files. Test keys are held by the local harness; these accounts are not public testnet accounts.

In a second PowerShell terminal at repository root:

```powershell
$env:VITE_DEPLOYMENT_URL='/deployment.local.json'
node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 4174 --strictPort
```

Open `http://127.0.0.1:4174/app`. The fixture is read-only in the browser and shows Local Sandbox separately from Simulated strategy. To stop the harness gracefully, create `artifacts/stop-browser-fixture`; remove that marker before the next run. The fixture network and its transaction IDs are ephemeral. The build packaging script excludes `deployment.local.json`; a build targeting that local file intentionally cannot connect after packaging. Build normal releases without the local `VITE_DEPLOYMENT_URL` override.

## Verification and signing boundary

For read-only public testnet inspection, run `npm run dev:testnet` and use `http://127.0.0.1:4175/app`. Its development-only middleware serves `deployments/testnet.json`, refuses signing-enabled manifests, and leaves the ordinary preview/build unchanged. See [milestone 9 browser evidence](../evidence/milestone-9.md). The actual wallet transaction sequence is defined separately in the [rehearsal review](../../deployments/REHEARSAL_REVIEW.md).

- RPC snapshots use a fresh finalized block and check chain ID, syncing state, exact code hashes, vault binding, token metadata, DAO policy and factory upgrade settings. A changed code hash or policy disables actions pending review of a new manifest. This MVP accepts only the three-member, two-vote transfer-only council profile with no per-role voting overrides; a weaker manifest is rejected too.
- Testnet mode requires HTTPS and chain ID `testnet`; Sandbox permits only loopback HTTP and disables signing. Mainnet configuration is rejected. Configuration is an operator-reviewed trust anchor, not cryptographic RPC proof or a guarantee that retained keys cannot upgrade contracts later.
- Signing requires a connected testnet wallet, matching account, fresh state and an exact reviewed call. Storage registration and operation costs come from contracts; a native NEAR preflight retains account storage and a conservative gas buffer. Wallet/network checks remain authoritative for actual fees and access-key allowances.
- The review shows account, contract, exact token/DAO, amount, recipient where applicable, withdrawal minimum, attached NEAR, gas and expandable raw parameters. No browser profit/loss controls exist in chain mode.
- Submission intent is saved before opening the wallet. A synchronous guard prevents duplicate prompts in the current app instance. Explicit wallet rejection is failure; timeout or missing hash stays unknown. Refresh preserves unknown requests and re-verifies all stored hashes. This is browser-local history, not a production indexer or cross-device/cross-tab transaction lock.
- Returned wallet objects and redirect hashes are only hints. RPC must return the same signer, receiver, one exact function call, arguments, deposit and gas. Recovery rejects a transaction at or before the review block and hashes already attached to another stored request. All reachable receipts must be present and final.
- Only logs from successful receipts at the exact token/vault count. Deposit resolver results distinguish accepted/refunded deposits. DAO approval alone is never shown as paid; the exact DAO-to-recipient token event must be present. A nested failure is highlighted even if the outer transaction succeeds.
- Interrupted balance reads and externally completed simulator redemptions have a version-bound recovery review after five minutes; see [recovery rules](recovery.md). Unknown outgoing payments/allocation results remain locked. The browser cannot force success or unlock reservations. Direct operation lookup supports older journal entries; the summary currently reads the first 50 operations and latest 50 proposals. There is no automatic historical transaction index.

Public testnet deployment completed through the CLI on November 7; [milestone 8](../evidence/milestone-8.md) retains finalized receipts and the audit. The [testnet manifest](../../deployments/testnet.json) is read-only and uses the replacement FASTNEAR RPC; the app still defaults to preview. User-wallet signing has not been executed. Connecting and rejecting the chooser is verified; redirect completion, account switching during signing and wallet-specific transaction rejection still need an authorized end-to-end rehearsal. Refresh requires reconnecting the wallet for new actions; receipt history remains readable without signing in.

RPC references checked during implementation: [transactions](https://docs.near.org/api/rpc/transactions), [protocol storage costs](https://docs.near.org/api/rpc/protocol), [gas price](https://docs.near.org/api/rpc/gas).

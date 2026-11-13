# Milestone 4 — chain frontend and receipt tracking

Verified 3 November 2026. This milestone adds an optional chain-backed frontend while retaining the explicit default browser preview. All executed financial transactions used an ephemeral local Sandbox harness. No public deployment or user-wallet signing occurred.

## Results

| Check | Result |
| --- | --- |
| TypeScript tests with live Sandbox enabled | 33 passed: 13 domain, 4 Sputnik builders, 16 chain/action/receipt checks |
| TypeScript typecheck and production build | Passed |
| Sites packaging tests | 4 passed; local deployment manifest removed from packaged client |
| Rust formatting | Passed |
| All-target, all-feature Clippy | Passed with warnings denied |
| Actual local fixture | Funded 1,000, redeemed 1,030, donated 30, DAO paid 20, treasury retained 10 |
| Browser reads | Overview, treasury, proposal and operation links render real Sandbox values without authentication |
| Responsive layout | Desktop 1440×1000 and mobile 390×844; no document horizontal overflow |
| Landing and wallet boundary | Landing has zero Connect wallet buttons and zero iframes; app chooser opens and Escape cancels |

Commands:

```powershell
# With scripts/serve-browser-fixture.sh running in WSL:
$env:YIELDFUND_LIVE_SANDBOX='1'
npm test
npm run build
npm run test:sites
```

```sh
cargo fmt --all -- --check
CARGO_TARGET_DIR=/home/crownab/.cache/yieldfund-near/target \
  cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
```

The new ignored `browser_fixture::serve_browser_fixture` integration test compiled and ran through setup and all funding/payment assertions, then intentionally remained alive to serve browser reads. It is not counted as a finished Rust test run while serving. The existing 18 Rust units and 10 financial Sandbox scenarios passed in milestone 3; contracts were not changed by this milestone and that full suite was not rerun here.

## Retained evidence

- `milestone-4-fixtures/deployment.json`: exact local fixture identities, policy, configuration and code hashes.
- `milestone-4-fixtures/transactions.json`: full finalized RPC transaction results for an accepted deposit and the second council approval/payment. Tests use these actual receipt trees, then mutate copies to test missing receipts, optimistic finality, payload mismatch and forged executor logs.
- `screenshots/chain-overview-desktop.png`: real 1,000 outstanding units, 1,000 idle cash, zero remaining eligible yield and 30 confirmed DAO funding.
- `screenshots/chain-proposal-mobile.png`: public proposal view, exact 20-token recipient and two council votes; approval is not mislabeled paid merely because the browser has no matching submission receipt history.

Tests also cover mainnet/wrong-RPC configuration rejection, account/stale-state guards, code/policy mismatch against the running RPC, storage and token preconditions, native funding preflight, and persisted success being rechecked after refresh. Unknown outcomes remain blocked. These tests are not an actual wallet-signing rehearsal.

Browser QA found a fetch binding error (`Illegal invocation`) that Node tests did not reveal. The client now invokes global fetch through an arrow wrapper; a fresh browser reload rendered the real values. Read-only Sandbox header originally offered a testnet wallet control; it now hides that control and labels the network correctly. Public risk/FAQ copy now explains both modes without initializing a wallet.

## Remaining acceptance

Public testnet manifest/authority review, user wallet execution and rejection/redirect/account-change rehearsal, multi-tab coordination, complete screen-reader testing and evidence-based recovery for missing callbacks remain outstanding. The local adapter checks do not certify all AC01–AC12 or production use. Rhea and Trezu remain unverified. See [frontend setup and boundaries](../contracts/frontend-chain.md) and the historical [contract evidence](milestone-3.md).

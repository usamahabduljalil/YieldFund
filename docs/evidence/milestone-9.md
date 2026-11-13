# Milestone 9 — public testnet browser checks and rehearsal preparation

Historical preparation record: 7 November 2026 (Africa/Lagos). The later approved eleven-call sequence completed on 12 November; see [execution evidence and remaining acceptance gaps](milestone-9-execution-notes.md). Observations below describe preparation only.

## Local session

`npm run dev:testnet` starts `http://127.0.0.1:4175/app` using the audited public testnet manifest. The launcher binds loopback, requires testnet with `transactionsEnabled: false`, and serves the manifest through a development-only middleware endpoint with `Cache-Control: no-store`. It accepts GET/HEAD and rejects POST. No manifest is copied into public assets or production output. Existing preview and Sandbox sessions are preserved.

[Launcher HTTP checks](milestone-9-launcher.json) confirm the runtime manifest matches disk, is read-only, and `/deployment.json` remains preview. The production build also retains preview and contains neither the local Sandbox manifest nor the testnet-session manifest.

## Observed browser behavior

The local app was inspected in the Codex in-app browser against public testnet, using the installed HOT Connect **0.12.0** connector and its current **NEAR CLI** wallet adapter. The adapter does not expose a version in its visible UI; its transaction path has not been verified.

- Landing: no wallet button or iframe before connection or after returning from the app. [DOM observations](milestone-9-landing.json), [screenshot](screenshots/milestone-9-landing.jpg).
- Disconnected overview: actual public testnet vault/DAO IDs, finalized block, zero units/cash/yield/donations, `Read-Only`, and simulated-strategy labeling. These are live initial balances, not preview fixtures.
- Wallet selection: opened the chooser, selected NEAR CLI, entered the operator's public account ID and selected the existing keychain method. Connection completed without a signature or key export. Account selection is not cryptographic authentication.
- Campaign: operator's actual **1,000,000 tUSD** balance, correct token and DAO, 10,000 cap; Register position and Review deposit disabled. [Screenshot](screenshots/milestone-9-testnet-campaign.jpg).
- Treasury: actual zero balance and no proposals; three reviewed members and two-vote threshold; Review proposal disabled. [Screenshot](screenshots/milestone-9-testnet-treasury.jpg).
- Operator view: correct guardian and strategy, authority disclosure and code-hash section; allocation, redemption, reconciliation, donation and pause controls disabled.
- Refresh: the app requires reconnection and returns to public reads; disconnected operator controls no longer appear. No account is silently restored.
- Cancellation: Escape dismisses the wallet chooser and displays `User rejected`, with Connect wallet available again. This is a connection cancellation, not an actual transaction-rejection test. [Screenshot](screenshots/milestone-9-wallet-cancelled.jpg).
- One transient RPC fetch failure displayed the existing reads-unavailable warning and kept signing disabled. Subsequent polling recovered fresh finalized state.
- Activity showed no browser wallet submissions and no campaign operations. [Screenshot](screenshots/milestone-9-testnet-activity.jpg).
- At the browser's existing 690px viewport, the campaign and landing document width was 675px, without horizontal overflow. This is not a new full responsive/accessibility sign-off.

## Preparation evidence

[Fresh deployment audit](milestone-9-audit-before.json) passed. [Preparation observations](milestone-9-preparation.json) and [unsigned transaction review](../../deployments/testnet-rehearsal.review.json) record a finalized operator snapshot, exact actor keys, native/token balances, storage costs and gas price. The initial campaign is still untouched. No signed payload, private key or seed phrase is included.

[The human-readable review](../../deployments/REHEARSAL_REVIEW.md) defines 11 transactions, 1,000 tUSD deposited, 30 funded profit/donation, a 20 tUSD DAO payment and a 200-unit withdrawal. The operator is also the supporter; the generic earlier separate-supporter funding step is unnecessary. Requested ceilings are 0.188 NEAR attachments and 1.25 NEAR gas. Approval is pending; neither budget is spent by this milestone.

## Verification and remaining work

- `npm test`: **82 passed**, one optional live Sandbox test skipped.
- `npm run build`: typecheck, Vite build and packaging passed.
- `npm run test:sites`: **4 passed**.
- Launcher HTTP behavior and exclusion from production configuration verified. No frontend component, design token or Rust contract changed.

Actual wallet transaction rejection, account/network changes during signing, pending-submission refresh recovery, funded lifecycle and DAO payment remain open. These are not inferred from CLI deployment evidence or account selection. The same-machine custody and unresolved outgoing-payment/allocation recovery limitations remain. Next step requires approval of the concrete rehearsal review under the hackathon brief's signing/spending rule.

# Milestone 10 — wallet session checks

12 November 2026 (Africa/Lagos). This milestone strengthens the frontend signing boundary after the completed eleven-call testnet rehearsal. No transaction was signed or sent during this milestone.

## Problem and behavior

React callbacks retained the account selected when they started. If that account changed while snapshot, funding, wallet lookup, or wallet-account checks were pending, comparing the captured value again could miss the change. Disconnecting and reconnecting to the same account also left an older review apparently valid.

Each wallet provider now maintains a session revision. Reviews capture both account and revision. Preparation checks that session after asynchronous reads; submission checks it before and after preparing fresh parameters. Wallet dispatch checks again after connector lookup, after wallet-account verification, and immediately before invoking the signing method. Disconnect invalidates the session immediately; provider teardown also invalidates pending work. Switching away and back requires a new review.

A failure before the signing method is invoked is recorded as **Not submitted**. Explicit rejection codes remain failed requests. Wallet closure, connection errors after handoff, and uncoded rejection-like messages remain **Unknown**, with no automatic retry. Once the signing method has been invoked, a returned hash remains available for the original account's receipt tracking even if the displayed account changes.

The wallet connector now uses the same current FASTNEAR endpoint mapping as public app reads. The reviewed deployment and persisted Activity scope are unchanged. Connector initialization remains lazy inside the application wallet provider.

## Verification

- 105 TypeScript/tooling tests passed; one optional Sandbox test skipped.
- Sixteen new controlled-adapter cases in `apps/web/src/wallet-session.test.ts` exercise the actual dispatch helper: disconnected review, exact single testnet call, stale account/disconnect, switch away and back, changes during wallet lookup/account lookup, unsupported wallet, wallet-side account mismatch, lookup failure, two explicit rejection codes, three ambiguous error messages, and a hash returned after account switching.
- Production typecheck and Vite build passed.
- All four hosting packaging checks passed.
- React review: session state belongs to each provider; event listeners have stable callbacks and cleanup; stale connection completions cannot overwrite newer account selections; receipt tracking stays bound to the persisted submission account. No additional runtime dependency.

These are automated checks using controlled wallet adapters. They do not establish real-wallet rejection behavior, React UI rendering during a live account switch, or a wallet's behavior after it accepts a signing request. No browser automation capability was available in this session. Final read-only position/treasury/Activity reconciliation, explicit rejection in a compatible wallet, and live account/network switching remain acceptance tasks.

The completed chain evidence remains [milestone 9](milestone-9-execution-notes.md): 800 units backed by 800 tUSD, 30 donated, DAO balance 10, recipient balance 20, and 200 withdrawn. Unknown outgoing contract callback recovery remains a separate release blocker.

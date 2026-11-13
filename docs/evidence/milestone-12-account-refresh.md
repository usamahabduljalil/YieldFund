# Milestone 12 — account-bound React refresh

12 November 2026, Africa/Lagos. Local frontend change; no signing, transaction broadcast, contract change, deployment or publication.

## Reproduced problem

The provider's global in-flight flag prevented a newly selected account from starting its own snapshot while the previous account's read was pending. Cleanup invalidated the old result, but the new account could wait until the next periodic refresh. Separately, a receipt handler retained the refresh callback for its original account: after that account changed, the old callback could start another read and publish the wrong account's snapshot under the current wallet header.

Three new React provider regressions failed before the fix: the new account never started reading immediately, a captured refresh queried the previous account, and loading remained true after an abandoned read failed.

## Change

Each committed account now owns its refresh lifecycle, in-flight guard and cleanup. Account changes start a new read immediately; old completions cannot write data, errors or loading state. A stable refresh entry point dispatches through the current account's reader, including calls from older receipt handlers. Cleanup also makes captured refreshes inert after unmount. The exposed snapshot is checked against the selected account ID as an additional rendering boundary.

Layout-effect cleanup replaces the current reader before painting account-specific data. Same-account refreshes remain deduplicated. Review/session checks, exact receipt verification, persisted submission ownership and the read-only deployment configuration are unchanged.

## Evidence

- `apps/web/src/chain-store.test.ts`: eleven tests mount the actual `ChainProvider` in React with controlled wallet and chain-read dependencies. They cover pending account switches, old captured refresh callbacks, abandoned read errors, disconnect/public state, same-account deduplication and retry, stale prepared reviews, an account change during funding checks, StrictMode/unmount cleanup, foreign snapshot suppression, explicit rejection and ambiguous wallet closure. Submission tests verify persistence occurs before the wallet handoff and that no automatic second call occurs.
- Before fix: 3 failed / 5 passed in the initial eight-case suite. After fix and additional cases: all 11 provider cases pass.
- Full suite: 119 passed, one optional Sandbox case skipped, nine test files.
- Production typecheck/build passed; all four hosting packaging tests passed.
- Added exact dev-only dependencies: React Testing Library 16.3.0, DOM Testing Library 10.4.1 and jsdom 26.1.0, compatible with the pinned Node/React versions. No new runtime dependency. Installed-package audit reported zero vulnerabilities at installation.
- React Best Practices review: stable callback for long-lived asynchronous handlers, account-scoped effect cleanup, isolated provider state, no rendering of foreign-account data, no additional wallet initialization on the landing page.
- Read-only browser smoke check: selected the remembered operator through NEAR CLI; position showed 800 units, zero reserved and 200 withdrawn at block 277411468. Disconnect immediately removed the account header and position metrics while public state reloaded. [Connected screenshot](screenshots/milestone-12-connected.png). This did not open or submit a signing request.
- Public reads completed after disconnect: My position asked for connection ([DOM](milestone-12-disconnected-dom.txt)), and Overview showed 800 units/cash, zero eligible yield, 30 donated and treasury 10 at block 277411991. [Public overview screenshot](screenshots/milestone-12-public-overview.png). Runtime configuration remained `transactionsEnabled: false`.

[Machine-readable checks and source hashes](milestone-12-checks.json) identify the tested revision.

Testing references: [React Testing Library API](https://testing-library.com/docs/react-testing-library/api/) and [Vitest environments](https://vitest.dev/guide/environment.html). These are emulated-DOM integration tests, not an actual browser wallet or public-chain signing rehearsal. Live rejection, account/network switching during signing, and unknown outgoing contract callback recovery remain open.

# Milestone 1 verification — 2 November 2026

Scope: local product preview and accounting foundation, not P0 release acceptance.

## Automated checks

| Check | Result |
| --- | --- |
| npm run build | Passed: TypeScript and Vite production build |
| npm test | Passed: 13 domain tests |
| npm run test:sites | Passed: 4 packaging/router tests |
| cargo test --workspace (Ubuntu WSL) | Passed: 6 accounting tests |
| cargo fmt --all -- --check | Passed |
| cargo clippy --workspace --all-targets -- -D warnings | Passed |
| npm dependency audit after version fixes | Zero known vulnerabilities reported at installation |

Domain tests cover strict token parsing, rounding, proportional loss, restoration before yield donation, quarantined unsolicited value, minimum payout and liquidity gates, owner-only request cancellation, reservation/retry/unknown-result behavior, final dust, multiple depositors and separate local treasury governance. Rust independently covers checked accounting, widened arithmetic, settlement and redemption/donation rules.

These checks do not establish token-hook authentication, private callbacks, real DAO authorization or NEAR receipt correctness. Those require the next milestone's contracts and Sandbox tests.

## Browser walkthrough

1. Landing rendered with reference cream/blue design and no wallet button.
2. Opened the app and accepted a 1,000 tUSD fictional deposit; it entered idle capital.
3. Requested 200 nominal units with minimum payout 200; settled the local request; position became 800 and preview wallet 9,200.
4. Applied a 30-unit preview strategy gain, reconciled, and donated exactly 30 to the separate treasury.
5. Approved the seeded 250-unit community payment as a distinct second council actor; executed it separately; proposal showed Paid and treasury 500.
6. Reloaded the app; the 800-unit position and activity persisted.
7. Opened the NEAR testnet wallet chooser and dismissed it with Escape. No wallet sign-in, key addition or signing was performed.
8. Checked 360px mobile layouts and drawer navigation. Corrected table overflow with a positioned scroll container; document width 345 inside a 360px viewport (15px scrollbar), rather than the earlier 422px overflow.

Screenshots are in `screenshots/`. `overview-before.jpg` and `withdraw-review.jpg` are earlier diagnostic captures, not final visual evidence. The final report identifies the final captures.

## Limitations

All capital, treasury and governance actions above were browser-local simulations. Seed balances and the community are fictional. The local council selector is a scenario control, not an access-control mechanism. Wallet account sign-in and chain transactions were not tested. Rhea, Trezu/Sputnik and funded test-token strategy integrations remain unimplemented. No AC01–AC12 chain acceptance claim is made.

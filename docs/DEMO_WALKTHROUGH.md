# YieldFund read-only demo walkthrough

This walkthrough shows the completed public testnet rehearsal. It does not repeat deposits, votes or withdrawals. All figures use a valueless example token, tUSD, and a funded deterministic strategy simulator.

## Start

From the repository root:

```sh
npm ci
node --experimental-strip-types scripts/serve-testnet.mjs --read-only-rehearsal
```

Open `http://127.0.0.1:4176/`. The normal production build and default preview are unchanged. This launcher serves the reviewed testnet configuration with signing disabled. Allow contract and historical receipt checks to finish; timestamps identify the displayed snapshot.

## Suggested recording sequence

1. **Landing:** show the community funding explanation and Launch app. The landing page has no wallet control.
2. **Overview:** identify NEAR testnet, funded simulation and read-only mode. Show 800 outstanding units, 800 recognized idle cash, zero eligible yield and 30 confirmed DAO funding.
3. **My position:** select the existing `yf-operator-261105.testnet` account through the NEAR CLI wallet chooser. This is account selection only. Show 800 remaining units, zero reserved units and 200 paid withdrawals.
4. **Treasury:** show 10 tUSD remaining, the three-member council and proposal #0. Two distinct council approvals paid 20 tUSD to `yf-council3-261105.testnet`.
5. **Activity:** show receipt-checked wallet submissions and completed campaign operations. Open withdrawal operation #4 to show its 200 tUSD payout. Browser history is local to this origin and browser profile; a fresh browser may have no saved submissions even though the on-chain journal is available.
6. **Evidence and limitations:** explain the original 1,000 deposit, controller-funded 30 profit, full redemption, 30 donation, DAO payment of 20, and withdrawal of 200. Distinguish historical receipts from a new live transaction demonstration.

Suggested narration: “YieldFund directs eligible realized surplus to a fixed community DAO. Supporters retain a claim on recoverable capital. This testnet demonstration uses actual test-token transfers and a funded simulator. The approved rehearsal donated 30, the DAO paid 20 after two council votes, and the supporter withdrew 200 while retaining 800 units backed by 800 tokens.”

## Evidence and boundaries

- [Eleven-call execution record](evidence/milestone-9-execution-notes.md), [exact totals and hashes](evidence/milestone-9-execution.json), and [final authority audit](evidence/milestone-9-final-audit.json).
- Eight normal browser CLI signing handoffs; deposit used approved CLI/hash recovery, profit funding used CLI, and the final withdrawal advance used CLI. Do not describe all eleven calls as browser transactions.
- Loss and delayed-liquidity cases are separate isolated Sandbox scenarios documented in [milestone 5](evidence/milestone-5.md); the public rehearsal did not run those faults.
- No verified Rhea or Trezu integration. Council keys share local custody. Contract full-access keys are retained. Unknown outgoing callback recovery remains unresolved; this is not ready for public deposits or production money.
- [Wallet acceptance matrix](evidence/wallet-rehearsal.md) separates controlled tests from actual wallet observations.

This file is a recording plan, not a completed video, observed user study, publication or submission. Record the final demo after the remaining acceptance checks. Public repository, hosting, license, team identity, submission consent and publishing remain separate decisions; no personal facts or public URLs are invented here.

# YieldFund read-only demo walkthrough

This walkthrough shows the completed public testnet rehearsal. It does not repeat deposits, votes or withdrawals. All figures use a valueless example token, tUSD, and a funded deterministic strategy simulator.

## Start with the hosted demo

Open https://yieldfund-eosin.vercel.app/ and use **Launch app**. No setup or wallet is needed to inspect public state. Use **Campaigns** to open Community Garden or Builder Commons after the campaign release is published. A DAO-verified badge means a metadata attestation, not a return or safety guarantee. The campaign details must show the selected campaign's vault; switch back to The Commons for the historical funded lifecycle below.

The final screenshot bundle and release checks are indexed in `docs/evidence/milestone-15-campaign-release.md`. Screenshots show actual rendered state; they are not a recording of the signing process. For a video, record the sequence below with your screen recorder and keep network labels and limitations visible.

## Local alternative

From the repository root:

```sh
npm ci
node --experimental-strip-types scripts/serve-testnet.mjs --read-only-rehearsal
```

Open `http://127.0.0.1:4176/`. This launcher serves the reviewed testnet configuration with signing disabled. Allow contract and historical receipt checks to finish; timestamps identify the displayed snapshot. The hosted build also uses read-only testnet configuration; default `npm run dev` remains a separate fictional preview.

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

## Three-minute narration outline

| Time | Screen and point |
| --- | --- |
| 0:00–0:25 | Landing → Launch app. Communities fund shared work through eligible yield donations. |
| 0:25–1:00 | Campaigns → Garden → Overview. Separate keyless vaults; DAO verification is an attestation. |
| 1:00–1:40 | Return to Commons. Show 800 backing and 30 donated; explain the funded test-token simulator. |
| 1:40–2:15 | Treasury → proposal #0. Two approvals, 20 paid, 10 remaining. |
| 2:15–2:40 | Activity → withdrawal operation #4. Show the completed 200 payout and receipt evidence. |
| 2:40–3:00 | Risks and repository. Mainnet/Rhea/Trezu deferred; callback limits disclosed. |

This is a recording plan, not a completed video. Public repository and hosting exist; original code uses the selected all-rights-reserved license. The user publishes the demo post and completes final submission manually. See [manual submission kit](MANUAL_SUBMISSION.md).

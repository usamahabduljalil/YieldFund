# YieldFund on NEAR implementation plan

November 12 scope expansion: the user authorized permissionless multiple campaigns, campaign verification, mainnet/Rhea/Trezu integration, GitHub publication and hosting. [Expansion plan](docs/EXPANSION_PLAN.md) supersedes the older single-campaign/testnet-only scope below. Historical completion evidence remains in agent.md.

Planning baseline: 2 November 2026, Africa/Lagos. This document preserves the intended full implementation. Current progress is in `agent.md`: the product preview plus local Sandbox vault, funded simulator, yield settlement and pinned Sputnik DAO integration are implemented as of 3 November; the complete MVP is not finished.

This plan translates the supplied project specification into a build sequence and incorporates the user's explicit UI requirements: a separate informational landing page without wallet connection, a complete application interface, concise component copy, and the visual language of nearhackathon.com. The project specification remains the detailed accounting authority.

## 1. Product and delivery decision

YieldFund lets supporters allocate tokens to a community campaign. Eligible realized yield goes to a fixed DAO treasury, which governs community payments. Supporters retain a claim on recoverable capital; losses and withdrawal delays are possible. Depositing does not grant DAO voting rights.

Build one complete Social Money demonstration: deposit → allocate → redeem strategy and reconcile → donate eligible yield → DAO proposal and payment → supporter withdrawal. Demonstrate a separate loss and liquidity-delay scenario.

The hackathon scope is one fictional open-source community, one allowlisted test token, one campaign vault, one strategy and one Sputnik DAO treasury. Use a funded strategy simulator by default. Attempt real Rhea testnet integration behind a verification gate; decide by 4 November. Trezu is the preferred existing treasury UI when compatible; otherwise expose a thin interface to the existing Sputnik DAO contract.

The following are planning recommendations, not completed integrations or approved production choices: React frontend tooling, connector selection, folder structure, operational roles and UI sizing. Contract addresses, versions, token decimals and DAO policy must be verified and recorded during implementation.

## 2. Sources and current evidence

| Source | How it informs this plan | Evidence limit |
| --- | --- | --- |
| [Local hackathon instructions](HACKATHON.md) | Eligibility, Social Money track, schedule and submission requirements | Recheck live rules immediately before submission |
| [Full project specification](YieldFund_on_NEAR_Full_Project_Description_and_Hackathon_MVP_Specification.docx) | Product scope, FR01–14, AC01–12, ledger and recovery rules | Planned design, not a validated implementation |
| [NEAR Hackathon site](https://nearhackathon.com/) | Visual reference inspected in browser on 2 November 2026 | Observed light theme; dark theme not measured |
| [NEAR integration testing](https://docs.near.org/smart-contracts/testing/integration-test) | Sandbox receipt and callback testing; current examples use near-sandbox and near-api | Exact toolchain compatibility remains to be tested |
| [NEAR Wallet Selector repository](https://github.com/near/wallet-selector) | Its README recommends evaluating HOT Connect for new integrations | Connector and wallet testnet support still require a spike |
| [Rhea supplying guide](https://guide.rhea.finance/near-chain-guides/lending-and-borrowing/supplying) | Variable rates and liquidity-dependent withdrawals | Does not verify a usable testnet deployment or current asset allowlist |
| [Sputnik DAO source](https://github.com/near-daos/sputnik-dao-contract) | Reuse existing governance contracts | Pin revision, deployed code and actual policy before use |

Product Design was used for brief definition, reference grounding and scope discipline. UI UX Designer was used for information architecture, concise interaction copy, responsive behavior, states and design handoff. This deliverable is a plan; visual mockup selection and implementation remain future work.

## 3. Two distinct user surfaces

### Public landing page at `/`

Purpose: explain the product, establish how funding works and direct visitors into the application. No wallet button, wallet modal, automatic wallet connection or signing request anywhere on this route, including mobile navigation and footer. Keep the wallet provider within the application boundary.

Header: YieldFund identity, How it works, Communities, Transparency, FAQ, and a primary **Launch app** link to `/app`. A wallet already connected inside the app must not change this header into wallet controls.

| Section | Content and layout | Action |
| --- | --- | --- |
| Hero | Large bold headline, one short supporting sentence, original YieldFund visual using the reference palette | Launch app; How it works anchor |
| How it works | Three numbered steps: Allocate capital; Fund the treasury; Govern community spending | Read the mechanics |
| Who it supports | Open-source groups, alumni communities and collectives; compact use-case blocks | View example campaign in app |
| Capital and yield | Clear distinction between remaining capital and donated yield; short loss/delay statement | Read risks |
| Transparency | Show the evidence chain from vault to treasury to community payment | View treasury in app |
| Example campaign | One clearly labeled fictional campaign; no fabricated TVL, supporters or APY | Explore campaign |
| FAQ | Expandable answers on withdrawals, losses, variable funding and DAO governance | Expand answer |
| Final CTA and footer | Launch app, documentation, risks and source repository when available | Launch app |

Working copy direction: **“Put capital behind your community.”** Supporting sentence: **“Allocate tokens. Send eligible yield to a community treasury.”** These are draft product lines, not a claim that yield is guaranteed.

### Application at `/app/*`

Purpose: browse campaign information, connect a wallet, contribute, follow funding, redeem capital and use the permitted treasury and operation controls.

Public reads remain available without connecting. Show **Connect wallet** in the app header and where a personal action requires it. After connection show the account menu, network and NEAR gas balance. Authorize every financial/admin action in contracts, not just through hidden UI.

| Route | Primary content | Primary action / access |
| --- | --- | --- |
| `/app` | Campaign overview, status, capital backing, treasury funding and recent activity | Support campaign; public read |
| `/app/campaigns/:campaignId` | Purpose, exact token, fixed DAO, strategy mode, risk summary and funding history | Deposit; requires connected account for signing |
| `/app/positions` | User's nominal claim, redemption estimate, realized loss, deposits, withdrawals and campaign donations | Request withdrawal; wallet-specific data |
| `/app/treasury` | DAO identity, policy summary, received donations, available treasury balance and proposals | Propose payment for eligible members; public read |
| `/app/treasury/proposals/:proposalId` | Recipient, asset, amount, approvals, expiry and execution receipt | Approve/reject if permitted by DAO policy |
| `/app/activity` | Deposit, allocation, settlement, donation, withdrawal and DAO payment records | Filter and inspect |
| `/app/operations/:operationId` | Amount, stage, timestamps, receipt links and recovery state | Retry only when contract state permits |
| `/app/manage` | Single-campaign setup before activation, metadata, caps, pause/close and settlement controls | Role-specific management |
| `/risks` | Detailed product, strategy, custody and withdrawal explanation | Return to campaign |

Desktop navigation: Overview, My position, Treasury, Activity; Manage is shown for relevant roles. Campaign details are reachable from Overview. Mobile uses four main navigation items with account and management in an accessible menu. Deep links survive wallet redirects and reloads.

The app exposes all MVP features. It does not present unavailable roadmap features as working navigation. Campaign setup is restricted to the authorized organizer; it is not an open campaign factory.

## 4. Visual direction and component rules

The reference's observed light theme is the initial YieldFund theme. Inherit its palette, typography hierarchy, square edges, fine rules, numbered section labels and restrained technical styling. Use YieldFund's own identity and artwork; do not repurpose the hackathon logo or claim event affiliation beyond participation.

### Measured reference tokens

| Token | Observed value | Intended use |
| --- | --- | --- |
| Background | `#e9e1cd` | Page canvas |
| Foreground | `#322e25` | Main text |
| Muted text | `#655d4f` | Secondary labels |
| Surface | `#e1d7c0` | Grouped regions |
| Card | `#eee7d6` | Financial panels |
| Popover | `#f4eddd` | Menus and dialogs |
| Primary / focus | `#005fb0` | Main buttons, links and focus |
| Primary foreground | `#fff7e9` | Text on primary buttons |
| Brand blue | `#0091fd` | Decorative emphasis |
| Brand sky | `#83dcff` | Limited accent |
| Border | `#b7ac94` | Panel and input boundaries |
| Divider | `#bdb199` | Section rules |
| Secondary | `#dcd2ba` | Secondary surfaces |
| Destructive | `#b53124` | Loss and destructive actions, with text labels |
| Radius | `0` | Square panels and controls |

Observed headings use `Arial, Helvetica, sans-serif`, weight 700. Body, navigation and controls use `IBM Plex Mono, monospace`. The site also declares `Pixelify Sans, monospace` as a pixel font; use it only for optional decorative accents, never monetary amounts. At the inspected narrow desktop viewport, H1 was approximately 59px and H2 42px; those are observations, not universal breakpoints.

Proposed YieldFund sizing: landing display 48–96px responsive; app titles 28–36px; section titles 20–24px; body 14–16px; auxiliary metadata 12px minimum. Use tabular numerals, explicit token units and restrained uppercase labels. Check actual contrast of each foreground/background pair; decorative blues and subtle borders are not automatically suitable for readable text or form boundaries.

Use an 8px spacing rhythm with 4px refinements, 16–24px mobile gutters, 24–32px desktop panel padding and a landing content width around 1200–1280px. App shell: roughly 224px sidebar on large screens, fluid content and a compact header. At widths below approximately 768px stack panels and use a full-width transaction sheet. Validate at 360, 768 and 1440px rather than trusting breakpoints alone.

Build reusable Button, AmountInput, Metric, StatusBadge, CampaignSummary, ActivityTable, TransactionReview, ReceiptLink, WalletControl, RiskNotice, ProposalPanel and OperationTimeline components. Keep status words visible; color is supplementary. Choose one consistent icon library. Use original imagery only where it helps explain the product; avoid decorative animation in financial forms.

### Concise copy rules

- Buttons normally use 1–3 words: Launch app, Deposit, Request withdrawal, View receipt, Propose payment.
- Labels normally use 1–4 words: Capital allocated, Estimated redemption, Yield donated, Pending withdrawal.
- Metric panels use a label, value and optional short status. Do not put a paragraph under every metric.
- Helper text is usually one sentence of up to about 15 words; omit it when the label is sufficient.
- Detailed explanations belong in expandable details, FAQ, risk pages and transaction reviews.
- Essential loss, delay, minimum-payout, fee and simulation information remains visible before signing. Concision must not hide material conditions.
- Example notice: **“Your claim can lose value. Withdrawals may be delayed.”** Follow with a Read risks link and a concise acknowledgement in the deposit review.
- Label chain and strategy separately: **NEAR testnet** and **Simulated strategy**. Testnet is not synonymous with mocked behavior.
- No guaranteed principal, risk-free claims, minimum APY, fabricated impact figures or unsupported live-integration badges.

### Required states and accessibility

All financial views cover disconnected, wrong network, loading, empty, stale data, insufficient token balance, insufficient NEAR, missing storage registration, rejected signature, broadcast/pending, confirmed completion, confirmed failure and unknown outcome. Campaign states cover settlement lock, paused, impaired, closing and closed. An unknown receipt outcome shows **Needs reconciliation**, not an invitation to send again.

Use semantic headings, associated input labels, visible focus, 44px minimum targets, keyboard-operable dialogs, focus return, reduced motion and screen-reader announcements for transaction changes. Show data age on estimates. Do not use pixel fonts for balances or make irreversible actions depend on hover-only explanations.

## 5. Main interaction flows

### Deposit

Landing → Launch app → campaign → Connect wallet → verify network → enter token amount → review token ID, treasury, strategy mode, gas/storage and risks → complete required registrations → sign `ft_transfer_call` → follow receipts → show accepted idle capital. Allocation is a distinct operation and status; a successful deposit does not imply successful lending supply.

The token hook authenticates the predecessor token contract, validates campaign phase/cap/storage and creates nominal units only on acceptance. Rejections return the unused amount through the token resolver, with no second manual refund.

### Withdraw

My position → Request withdrawal → choose nominal units → show estimated payout and loss → set minimum payout → confirm request → reserve units → queue until full strategy redemption and reconciliation → pay once → show receipt and updated position. Below-minimum requests stay queued; owners can cancel before processing or update the minimum through a verified method. If no update method is implemented, cancellation followed by a new request supplies that functionality safely.

### Fund and spend from the treasury

Authorized/bounded settlement trigger → lock new risk → redeem all → reconcile → reserve eligible surplus → transfer to fixed DAO → verify receipt → eligible member proposes payment → configured votes approve → execution sends tokens → verify recipient receipt. A proposal marked approved is not displayed as paid until transfer evidence confirms it.

### Operate and recover

Manage → inspect operation journal → use stage-specific permitted advance/recovery action → reconcile receipts and balances → resume only after invariants pass. Pausing blocks new risk without creating an arbitrary withdrawal or asset-sweep power. Timeouts alone never justify replaying a payout.

## 6. Architecture and implementation boundaries

Proposed frontend: React + TypeScript + Vite, a router for the surfaces above, shared CSS tokens and a query cache for RPC reads. Use a static frontend deployment with correct deep-link fallback. Reassess prerendering later if landing-page indexing becomes a requirement. Pin tested package versions and the package-manager version when scaffolding.

Wallet: put a narrow connector adapter behind the app boundary. Evaluate the currently recommended HOT Connect path first; retain Wallet Selector as a compatibility option only after testing actual wallet/network support. Required behaviors: connect/disconnect, account change, explicit network, sign/send, rejection handling and return from wallet redirects. Never request private keys.

Contracts: Rust `near-sdk`; campaign registry/configuration, positions, vault accounting, operations and internal strategy adapter are modules in one campaign vault contract. The vault owns the external lending position. Separate development contracts supply a standards-compliant test token and funded strategy simulator. Reuse the selected Sputnik DAO implementation, not custom multisig logic.

Reads: contract views and finalized receipts are authoritative. Start with direct RPC and bounded pagination. An optional lightweight cache may improve history browsing, but cannot invent spendable balances or overwrite unresolved operations. Deduplicate events by receipt ID and event index. Persist operation identifiers for refresh recovery and recheck chain state on return.

Off-chain services: only add a keeper if needed to advance bounded operations. It must not supply NAV, change recipients or choose arbitrary method names. Store descriptive metadata off-chain with a hash where practical. No production database or full indexer is required for the initial slice.

Suggested repository layout, to create during implementation:

```text
apps/web/                     landing, app routes and UI
packages/domain/              integer amounts, typed views and operation schemas
packages/near-client/         RPC, wallet adapter and receipt handling
contracts/campaign-vault/     configuration, ledger, journal and adapters
contracts/test-token/         test-only NEP-141 token
contracts/strategy-simulator/ funded profit, loss and liquidity controls
tests/integration/            Sandbox vault + token + strategy + DAO flows
deployments/                  verified public manifest; no private keys
docs/evidence/                acceptance output, receipt IDs and capability matrix
scripts/                      reproducible local build/demo helpers
```

Manifest fields: network, token ID/decimals, vault, strategy mode/account, DAO, source revisions, Wasm hashes, deployment authority, caps, gas/storage budgets, dust policy and evidence date. Values remain unresolved until verified; do not invent plausible addresses.

## 7. Accounting and asynchronous safety

Implement specification sections 7–11 exactly, then validate against an independent integer reference model. Use raw token base units, checked arithmetic and widened intermediate multiplication. JSON amounts are strings; the frontend uses integer-safe parsing and formatting, never floating-point money calculations.

At a fully settled checkpoint, let `C` be controlled token cash, `V` the external position, `T` proven in-transit assets and `X` excluded funds/liabilities. Net backing is `A = C + V + T - X`. Outstanding nominal units are `P`, including queued units. Supporter backing is `B = min(A, P)`, candidate surplus is `Y = max(A - P, 0)` and shortfall is `L = max(P - A, 0)`.

For MVP priced exits and distributions, require full strategy redemption: `V = 0`, `T = 0`, with any strictly bounded dust excluded from spendable backing. Cash reconciliation and provenance checks must pass. Candidate surplus is not automatically eligible lending yield.

- Accepted deposit `d` adds `d` to both `A` and `P`. New deposits require a healthy settled phase, no unresolved operation and `A >= P`.
- Redeeming `b` nominal units pays `floor(b * min(A, P) / P)` for `P > 0`; settle the last claimant explicitly to avoid stranded rounding dust.
- Surplus belongs to the campaign policy. Supporters cannot redeem more than nominal basis or capture prior campaign surplus.
- Impairment blocks deposits and distributions; later gains restore capital backing before creating eligible surplus.
- Quarantine unsolicited transfers, unrelated rewards and refund obligations. Do not label them lending yield.
- Reserve outbound cash and provisionally remove redeemed units before transfer. Effective balances exclude those reservations once, not twice.
- Confirmed failure restores reservations exactly once. Ambiguous success stays locked pending evidence, including when transfer succeeded but callback failed.
- Stage-specific private callbacks check predecessor, operation ID and state version. No arbitrary external targets, force-success controls or time-based force-unlocks.
- Keep work per transaction bounded. Never iterate through every supporter to settle or calculate totals.

Golden scenarios: deposit 1,000 → funded profit 30 → donate at most 30 → backing 1,000. Separately, backing 900 against 1,000 nominal units → no donation → redeem 200 units for 180 → remaining backing 720 and nominal units 800. Recovery to backing 810 permits at most 10 eligible surplus.

## 8. Integration decisions and fallback gates

| Gate | Evidence needed | Fallback / consequence |
| --- | --- | --- |
| Toolchain | Pinned Rust/SDK/build tools; reproducible Wasm; usable Sandbox on the development environment | Resolve environment before contract milestones; use a documented compatible Linux environment if Windows is unsupported |
| Wallet | Actual testnet wallet connection, signing, rejection, account change and redirect recovery | Choose a verified connector/wallet pair; do not claim all wallets work |
| Token | Exact identity, decimals, storage and resolver behavior | Deploy clearly labeled test token; block unsupported tokens |
| Rhea | Network, ABI/source, supply credit/refund precision, full redemption and nested receipt evidence | Simulator-only if not proven by 4 November |
| DAO | Pinned contract, 3 members, verified 2-approval policy, bond, expiry, token registration and payment receipt | Keep beneficiary routing inactive until demonstrated |
| Trezu | Selected network and DAO supported by actual UI | Thin app UI for the same existing Sputnik contract |
| Provenance | Funded simulator profit, real reduction in recoverable test assets for losses | Do not substitute dashboard-only numbers |
| Deployment authority | Code hash, retained keys, upgrade and pause powers documented | No production-readiness claim |

No borrowing, leverage, collateral actions, swaps, bridges, Intents, reward-token conversion, multiple strategies, transferable shares, governance tokens, AI spending, charity certification or production-money launch in this MVP. CSV export and a second isolated campaign are P1 only after all P0 evidence passes.

## 9. Milestones and exit evidence

Dates are planning targets in Africa/Lagos, not completion records. Role names describe responsibilities and do not imply additional team members.

| Target | Milestone | Exit evidence |
| --- | --- | --- |
| Nov 2 | Scope, visual rules, accounting examples and integration inventory | This plan; `agent.md`; unresolved gates recorded |
| Nov 3 | Validate toolchain; vault/token skeleton and deposit path; prepare landing + app visual targets | Accepted/rejected hook tests; UI target review |
| Nov 4 | Rhea and wallet spike; DAO compatibility; final demo strategy decision | Supply/redemption evidence or explicit simulator decision |
| Nov 5 | Simulator, allocation journal and complete redemption/checkpoint | Real test-token movement and reconciled receipts |
| Nov 6 | Queued withdrawals, impairment, minimum payout and retries | Healthy/loss/failure cases pass |
| Nov 7 | Eligible distribution and governed DAO payment | DAO funding, insufficient vote, successful payment receipts |
| Nov 8 | Landing, app shell, campaign and My position implementation | Wallet-free landing; complete deposit/withdraw UI |
| Nov 9 | Treasury, activity, operations and exceptional states | Every displayed completed movement opens evidence |
| Nov 10 | Adversarial, invariant, responsive and accessibility checks | No unresolved critical accounting/auth defects |
| Nov 11 | Full rehearsal and feature freeze | Stable happy path plus loss/delay scenario |
| Nov 12 | Clean setup and three observed walkthroughs | Reproducible README; corrected comprehension failures |
| Nov 13 | Demo recording and release evidence | Video, capability table, manifests and reviewed materials |
| Nov 14, 18:00 WAT | Internal submission target | Authorized publication; reviewed final payload |

Official deadline in supplied brief: **14 November 2026, 23:59 UTC = 15 November 2026, 00:59 WAT**. Keep the demo available through 18 November, preferably 25 November. Recheck live event rules before release.

Critical path: correct deposit → strategy redemption/reconciliation → safe payout/distribution → real DAO payment → reproducible evidence. UI work should progress against typed fixtures while contracts are built, but fixtures must remain labeled and must be replaced or explicitly declared in the final capability table.

## 10. Acceptance and verification

| Test | Requirement | Required outcome |
| --- | --- | --- |
| AC01 | FR01–02 | Network, exact token, DAO and simulation status are clear before signing |
| AC02 | FR03–04 | 1,000 accepted tokens create 1,000 nominal units; rejected hook refunds with no credit |
| AC03 | FR05, FR10 | Failed/partial allocation reconciles without duplicate credit |
| AC04 | FR06, FR08 | Funded profit 30 on 1,000 permits at most 30 donated tokens |
| AC05 | FR04, FR07 | Healthy 200-unit exit pays 200 once |
| AC06 | FR06, FR11 | Backing 900 / units 1,000 blocks yield; 200-unit exit pays 180 |
| AC07 | FR06–07, FR10 | Unavailable redemption queues exit without payout or fabricated yield |
| AC08 | FR09 | One of three votes cannot pay; valid threshold and successful execution can |
| AC09 | FR03, FR08, FR10 | Fake token, forged callback, unauthorized action and changed recipient fail |
| AC10 | FR07–08, FR10 | Duplicate actions and interrupted callbacks never pay twice |
| AC11 | FR04, FR08–09 | Completed funding/payment totals reconcile to actual token receipts |
| AC12 | FR12 | README distinguishes implemented, simulated and planned capabilities |

Additional UI acceptance: no Connect wallet control or wallet initialization on `/`; Launch app navigates to the app; wallet controls work only within app routes; compact copy meets section 4; mobile/keyboard navigation works; refresh resumes pending operations; public reads work without authentication; misleading success states are absent.

Verification layers: Rust ledger/property tests; Sandbox tests deploying real Wasm for vault, test token, simulator and selected DAO; frontend amount parsing/state tests; end-to-end browser walkthroughs with wallet rejection, wrong network and refresh; visual comparison to reference-derived design targets. Use actual nested receipts for asynchronous behavior. Include overflow, rounding, unsolicited transfers, forged callbacks, stale operation IDs, transfer-success/callback-failure and unregistered recipients.

Document source revision, commands, outcomes and receipt IDs for the final candidate. No accounting, authorization or duplicate-payout defect may remain unresolved at release. Do not invent test commands or passing results before the tooling exists.

## 11. Release and project tracking

Maintain `agent.md` after each meaningful work session: completed work with evidence, current task, next task, blockers and decisions. A small `AGENTS.md` entry points future coding agents to that file and this plan. Preserve the source specification and hackathon brief unchanged.

Prepare README with prerequisites, pinned versions, actual commands, expected balances, network/account manifest, mocks, retained keys, limitations, code attribution and demo evidence. Record the eligible NEAR contribution separately from earlier YieldFund concepts or code. Recommended track is `social`; final track selection belongs to the user.

Publication/submission are separate future steps. The supplied HACKATHON.md requires explicit authorization for pushes, making the repository public, signing transactions/spending tokens and mainnet deployment. Final submission needs the user's actual identity/contact facts, mainnet prize account, public links, consent and confirmation of the exact payload. This planning request authorizes none of those external actions. Prepare concrete artifacts before requesting any required approval at that stage.

Follow `agent.md` for the current next task and actual test evidence. Funded strategy/DAO contracts and the chain frontend are implemented locally. Milestone 5 adds stage-specific recovery. Milestone 6 adds deployment planning/authority audits and explicitly requested testnet actor creation. The November 4 Rhea gate passed without lifecycle proof; funded simulation is the MVP baseline. Public contract deployment, wallet execution and recovery for unknown outgoing payments/allocation remain outstanding. Keep subsequent scope changes explicit in the decision log.

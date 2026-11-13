# YieldFund implementation visual QA

Date: 2 November 2026. Scope: first local implementation milestone.

## Source and comparison

- Source visual truth: [NEAR Hackathon](https://nearhackathon.com/), captured as `docs/evidence/screenshots/near-reference.jpg`.
- Rendered implementation: `http://127.0.0.1:4173/`, captured as `docs/evidence/screenshots/landing-desktop.jpg`.
- Both desktop CSS viewports: 1440 × 1000, DPR approximately 1. Both saved comparison images: 1425 × 990 pixels, as returned by the browser capture surface. Same capture method and scale; no resampling. Light theme, top of page, no cookie overlay or open menu.
- The source and implementation were displayed together in one comparison input, then reviewed again after the fixes below. This is a design-language adaptation for YieldFund, not a pixel clone: the split hero, original garden image, product copy and app layout intentionally differ from the event page.
- Final app evidence: `docs/evidence/screenshots/overview-desktop.jpg` and `overview-mobile.jpg`. Final landing mobile: `landing-mobile.jpg`. Mobile CSS viewport 360 × 800; browser capture 345 × 767. Tablet overflow checked at 768 × 1024.
- Full-view typography, controls, palette and artwork are readable at the native comparison scale. No additional focused source crop was necessary for this design-language comparison; transaction and treasury states were separately reviewed in the browser. Earlier `withdraw-review.jpg` and `overview-before.jpg` are diagnostic captures only.

## Findings and iteration history

1. **Resolved P2 — small app text.** Early labels used 8–11px text, making dense financial panels difficult to scan. Raised small UI text to at least 12px; retained bold sans-serif headings and monospaced data. Rechecked desktop overview, treasury and mobile layout.
2. **Resolved P2 — artwork background darkened.** The image's multiply blend produced a noticeable darker rectangle against the cream surface. Removed the blend treatment. Final landing and overview show the intended blue/cream artwork without the darkened panel.
3. **Resolved P2 — mobile activity table overflow.** A visually hidden absolute header escaped the unpositioned scroll container, extending the document to 422px at a 360px viewport. Added `position: relative` to `.table-scroll`. After restarting a stale development server and refreshing, computed containment is relative and document width is 345px, matching the available viewport width.
4. **Resolved P2 — narrow landing header overflow.** At 360px the logo, launch action and menu exceeded the available width. Added a compact header treatment below 400px: smaller brand, tighter spacing, no decorative arrow inside the launch action. Rechecked: document width equals client width, 345px. All header controls remain visible.
5. **Resolved content correction — withdrawal review recipient.** The recipient row now says Preview supporter for withdrawals and the community treasury for deposits. Deposit success now says Deposit accepted, because strategy allocation is a separate action.
6. **Resolved keyboard navigation issue.** The closed mobile app drawer is inert; when open, background content is inert, focus is contained, Escape closes it and focus returns to the trigger.

After these fixes, the final combined source/landing comparison and final app/mobile captures had no actionable P0/P1/P2 visual findings within this milestone's scope.

## Required fidelity surfaces

- **Fonts/typography:** Arial/Helvetica bold display headings and locally loaded IBM Plex Mono controls/body match the reference's measured families. Strong size hierarchy and restrained uppercase metadata. Compact dashboard text is intentionally denser than the marketing page.
- **Spacing/layout:** Square panels, thin separators, broad landing margins, numbered sections and regular spacing retain the reference character. The two-column product hero and persistent app sidebar are intentional product adaptations. Mobile stacks the hero and metric panels; wide tables scroll inside their container.
- **Colors/tokens:** Cream `#e9e1cd`, ink `#322e25`, muted `#655d4f`, card `#eee7d6`, blue `#005fb0` and border `#b7ac94` are mapped into shared CSS variables. Blue remains the action color. No generic rounded/shadow card system was substituted.
- **Image quality:** Original generated blue halftone garden fits the reference's print/pixel art direction. Source/event logos and its animated sphere are not copied. No CSS/inline-SVG reconstruction of the source illustration was used. Phosphor provides standard interface icons.
- **Copy/content:** Short labels and values dominate app components. Longer text is limited to risk explanations, reviews and recovery. Local preview banners and fictional campaign labels distinguish mock values from real funds; no fabricated APY or live performance claim.

## Interaction and runtime evidence

- Landing has zero Connect wallet buttons; wallet code is lazy and only initialized inside the application.
- Browser walkthrough completed local deposit, withdrawal, reconciliation, eligible donation, proposal approval and payment. Refresh retained the current position.
- Testnet wallet chooser opened and Escape dismissed it. Account sign-in and signing were intentionally not exercised.
- Mobile menu/drawer, table scrolling and responsive layouts checked. Native transaction dialogs provide keyboard dismissal and focus return.
- Fresh browser-tab startup console: no errors or warnings. Earlier development-only React HMR errors occurred while formatting/replacing the entry file; they did not recur in the clean session after reload. No production runtime assurance is inferred from the development checks.
- Build/typecheck, domain/Rust tests and packaging checks passed; see `docs/evidence/milestone-1.md`.

## Follow-up and remaining scope

- P3: optimize the generated 2.2 MB artwork for delivery after visual approval, retaining detail.
- Full screen-reader audit, 200% text scaling, real connected-account states and chain failure/recovery UI require further testing as integrations arrive.
- The functional release remains incomplete: no deployable vault, funded simulator, Rhea lifecycle or Sputnik integration exists yet. This visual pass does not certify financial correctness or complete AC01–AC12.

## Implementation checklist

- [x] Compare reference and rendered landing together.
- [x] Fix text size, image treatment and mobile overflow.
- [x] Verify local flows and refresh state.
- [x] Record truthful preview boundaries and follow-up work.
- [ ] Complete on-chain MVP and receipt-level acceptance tests.

final result: passed

## Milestone 4 follow-up — 3 November 2026

This entry supersedes the earlier milestone's statement that no vault/simulator/DAO exists. Those contracts now have milestone 3 local evidence. This pass covers the new chain UI, not public wallet signing or all financial acceptance tests.

- Compared retained `overview-desktop.jpg` and `chain-overview-desktop.png` together at the same 1440×1000 viewport (1425×990 captured content). Shared cream/blue tokens, fonts, navigation, spacing, thin borders and square panels remain consistent. Operational contract data replaces the preview's featured campaign artwork in chain overview; preview and landing retain the original art.
- Captured `chain-proposal-mobile.png` at 390×844. Measured document width 375 within the 390 viewport, with no horizontal overflow. Recipient, amount, token and votes stack; mobile navigation opens and route selection closes it. Desktop document width 1425 within the 1440 viewport.
- Real Sandbox overview reads 1,000 outstanding units, 1,000 idle cash, zero remaining eligible yield and 30 confirmed funding. Treasury reads 10 after the harness's actual 20-token payment. Proposal status stays Approved unless this browser verifies the matching receipt; no approval-to-payment shortcut.
- Landing checked with zero Connect wallet buttons and zero iframes. Launch app loads preview with an explicit mode banner. App testnet chooser opens; Escape cancels and displays User rejected. No wallet account was selected or signed.
- P1 runtime issue corrected: unbound browser fetch caused Illegal invocation. The client now calls fetch through an arrow wrapper; real chain values render after reload. P2 mode issue corrected: read-only local Sandbox no longer offers a testnet wallet button.
- Public risk and FAQ copy now distinguish browser preview, configured chain mode and the funded simulator. Transaction reviews show exact recipient/amount and withdrawal minimum, with longer text reserved for essential risks and recovery.

Final result for the inspected read-only desktop/mobile views: passed. Connected-wallet dialogs, refresh during actual signing, full screen-reader navigation and 200% text scaling remain unverified. Evidence: `docs/evidence/milestone-4.md`.

## Milestone 5 follow-up — 3 November 2026

Added recovery inside the existing operation panel, retaining Product Design reference-derived tokens and UI UX Designer concise controls. Compared the prior chain overview and new operation capture together at 1440×1000 for shared shell, typography, borders and spacing. No new visual system or assets were introduced.

- A real fault-artifact checkpoint appears as Reconciling and shows the five-minute availability time. After finalized chain time crossed that threshold, Refresh showed Resume balance check. The button remains disabled in the explicitly read-only Sandbox.
- Mobile 390×844 stacks all operation fields and the recovery control without horizontal overflow (document width 375). Desktop document width is 1440 at viewport width 1440. Full mobile and desktop evidence is in `docs/evidence/screenshots/recovery-mobile.png` and `recovery-desktop.png`.
- The original amount, owner/recipient and minimum remain available. Connected-wallet review copy distinguishes restarting a balance check, which may complete the original payment, from checking strategy return evidence. That signed-wallet review was not exercised in the browser.
- Browser console reported no errors/warnings after loading the fresh fixture. Production build and packaging checks passed. Local fixture configuration stays excluded from packaged output.

Final result for inspected read-only recovery states: passed. Actual public-wallet recovery signing, screen-reader testing and 200% text scaling remain outstanding. The local fixture intentionally uses fault-enabled Wasm and discloses that boundary.

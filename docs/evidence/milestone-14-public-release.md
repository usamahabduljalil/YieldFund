# Public release and campaign browser foundation

13 November 2026. This records verified publication and the subsequent campaign UI increment. It is not proof of a public factory or mainnet yield lifecycle.

## Published baseline

- Public source: https://github.com/usamahabduljalil/YieldFund. Default branch: `codex/hackathon-release`.
- Live read-only testnet app: https://yieldfund-eosin.vercel.app/.
- Vercel project `yieldfund`, team `usamahabduljalils-projects`, project ID `prj_zM8diLP5QE7NYMOYtGoFPT3DIeEG`.
- Baseline deployed commit `c282f40cdaba593f2630d3adb7acd8467b78a049`, READY deployment `dpl_F94rBB2uvueiJqqHXwta6DwEeFD3`. Node 22.x.
- GitHub CI [43396632842](https://github.com/usamahabduljalil/YieldFund/actions/runs/43396632842) passed both web and contracts. Contract regression: 32 units and 14 Sandbox scenarios passed; one fixture-generation test ignored.
- Earlier CI failed because rebuilding upstream Sputnik produced a different Wasm hash. The fixed integration workflow verifies and uses the exact reviewed historical binary. The separate source-rebuild command still rejects differing hashes; cross-machine reproducibility remains unresolved.
- Public `/`, `/app`, `/app/campaigns/commons`, `/app/treasury/proposals/0`, `/risks` returned 200 HTML. `/deployment.json` returned the reviewed testnet manifest with transactions disabled. Missing assets/API routes returned 404.
- Hosted browser showed 800 units/cash, 30 donated, 10 in the treasury and four completed operations at block 277487832. Landing has no wallet control.
- Deployment is currently manual from exact GitHub SHAs through the authenticated Vercel API. Automatic Git deployment is not connected.

## Campaign increment

- `/app/campaigns`: network-scoped, paginated registry reads. Checks finalized block freshness, chain ID, code hashes, immutable token/template/verifier configuration, campaign child bindings and attestation expiry/revocation. Commons remains available separately and is labeled unverified.
- `/app/campaigns/new`: canonical metadata hash, immutable treasury/cap review and downloadable unsigned drafts. If a reviewed registry is configured, funding and campaign-ID availability are re-read at one finalized block before constructing the unsigned call. Duplicate checks query the exact ID, including campaigns outside the visible page.
- Registry snapshots cannot cross network/page boundaries. Editing a field or changing network invalidates outstanding reviews, including asynchronous completions.
- Mainnet/testnet wallet adapter sessions bind network, account and revision. Tests prove exact mainnet dispatch and reject cross-network tokens and testnet-only wallets. This does not enable or prove browser signing on mainnet.
- `registry.json` is deliberately empty: no public factory has been deployed. Mainnet shows an unavailable state, with no fake campaign or signing button.
- Local browser walkthrough on port 4177 created and downloaded `yieldfund-community-gardens-draft.json`. It contains token decimals 6, cap `10000000000` for entered 10,000, fixed treasury `dao.yf-operator-261105.testnet`, hash `8ce111075b1d6f9df99232ffc1c71bc4e387a355b3e464758a929b1964211ec7`, `draft: true`, `signed: false`. No transaction was sent. Switching to mainnet removes the testnet draft.
- Local TypeScript suite: **146 passed, one optional local-Sandbox skip**. Includes registry validation, DAO proposal permissions, wallet network isolation and asynchronous draft invalidation. Typecheck and hosted build pass.

## Remaining work

Public factory deployment, signed creation and receipt tracking, selected-campaign runtime, DAO verification proposal/vote UI, partial-creation repair/refunds, mainnet token precision throughout legacy screens, funded Rhea supply/redemption proof, Trezu discovery/payment rehearsal and unresolved callback recovery. The supplied mainnet account was absent at discovery; the current code-storage cost exceeds the 5 NEAR cap. No mainnet transaction was signed or broadcast. Historical testnet approvals were not replayed.

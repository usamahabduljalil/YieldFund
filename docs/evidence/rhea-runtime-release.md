# Rhea application runtime release

18 November 2026 (Africa/Lagos). Post-deadline implementation; this is not a claim of mainnet lifecycle completion.

- Core contract/Trezu source: `88341f0e5ecb31a1b59955f64016be9cae3b6c3f`. Both jobs passed in [CI 44126489902](https://github.com/usamahabduljalil/YieldFund/actions/runs/44126489902), including the actual downloaded Rhea binary lifecycles in local Sandbox.
- Runtime source: `5853714eca0318f5cb71d00fbf1e1b4833c00f13`; final deposit-copy correction: `b6257de6e43da299f4dd5f1ba16140afb3eb4f85`.
- Production Vercel deployment: `dpl_GXacZsutwzKfCWJzsWzv4182WoEH`, READY, exact source `b6257de`, project `prj_zM8diLP5QE7NYMOYtGoFPT3DIeEG`. [Public app](https://yieldfund-eosin.vercel.app/).
- Local validation: 195 TypeScript/tooling/UI tests passed, one optional skip; production hosted build/typecheck passed; four packaging tests passed. Seven of the local tests belong to earlier uncommitted recovery tooling and are excluded from this release. The two-label final correction passed typecheck and four targeted UI tests; Vercel rebuilt that exact final revision successfully.
- Source `5853714` web CI passed; contract rerun was still running at this checkpoint. Final-copy [CI 44217154725](https://github.com/usamahabduljalil/YieldFund/actions/runs/44217154725) remains a separate run; no claim of completed contract CI for that revision here.
- Local browser verified finalized testnet overview and treasury, including the 800 nominal/800 cash, 30 donated and 10 treasury balance of the historical campaign. Mainnet UI behavior is covered by RPC/UI fixtures, not a live deployed Rhea vault.
- Hosted `/deployment.json`, `/registry.json` and `/app/treasury` returned HTTP 200 through the Vercel connector. Both manifests have signing disabled and still select the historical testnet simulator. The local network timed out reaching the public host from the desktop browser and PowerShell; hosted visual verification could not be completed in that browser. No bypass or wallet signing was attempted.

The source adds explicit Rhea reads and mode checks, 0–24 decimal token amounts, mainnet wallet dispatch, network-scoped campaign selection, guarded redemption continuation and DAO-bound Trezu links/template exports. No simulator is substituted for a Rhea runtime. Read-only mainnet hosting is supported; no mainnet runtime manifest was invented or activated.

Still required: a real treasury DAO ID (the supplied Trezu ID is a passkey wallet), enough operator funding, Rhea factory support, exact signing review, fresh deployment, live supply/redemption/donation receipts and live Trezu/wallet acceptance. The replacement operator held about 0.341 NEAR at the recorded read; current vault code storage alone is about 4.28 NEAR before state/gas/token requirements. No mainnet spending occurred.

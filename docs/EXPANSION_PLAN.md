# Permissionless campaigns and mainnet integration

Scope authorized November 12, 2026. This supersedes the original single-campaign/testnet-only boundary without changing historical evidence or the original specification.

November 13 priority change: the user deferred mainnet deployment to focus on the testnet demo, public repository and manual submission. Mainnet spending is inactive. Rhea's real-money lifecycle and Trezu mainnet interoperability remain unverified and are excluded from completion claims. The approved campaign release is recorded in deployments/CAMPAIGN_RELEASE_REVIEW.md; it does not authorize unrelated token movements. Final submission and the public demo post are handled by the user.

## Deliverables

1. Caller-funded permissionless creation using pinned vault/strategy templates and separate keyless accounts per campaign. Token, beneficiary DAO and accounting bindings are immutable.
2. Paginated discovery and campaign selection. Reviews, positions and receipts are scoped to network and vault; existing Commons evidence remains valid.
3. Unverified by default. The user selected DAO approval: a configured Sputnik DAO issues or revokes expiring attestations tied to immutable campaign metadata through approved function-call proposals. A badge is not a guarantee of safety or returns. Individual council members and creators cannot directly verify a campaign.
4. Explicit mainnet/testnet configuration, chain-ID verification, network-bound wallet sessions and exact token metadata.
5. Rhea supply-only adapter: no borrowing/collateral; correct internal precision; full redemption and actual-token reconciliation. An execute response alone cannot prove withdrawal completion.
6. Trezu interoperability with the same Sputnik beneficiary DAO. Verify DAO discovery, policy/token display, proposals, threshold execution and payment receipts. A link is not a completed integration rehearsal.
7. GitHub repository, CI, detailed maintainable README and verified Vercel hosting.

## Sequence

Implement/test the factory and registry locally, then campaign UI and network support. Pin integration sources and read actual protocol state. Test adapters and multiple isolated campaigns in Sandbox. Prepare exact mainnet calls against the user's account and spending limits. Publish the tested revision and verify hosted routes and wallet behavior.

The user supplied mainnet account `7816689a9b3a6aea2f74f9ff8d7228603f440fffff9a138a43558c6d0dff596b` and a total 5 NEAR cap. Read-only discovery at mainnet block 224267966 returned UNKNOWN_ACCOUNT. Vault plus simulator code storage alone requires 6.10859 NEAR at the observed protocol storage price; the current embedded-template factory adds 9.10144 NEAR. This deployment architecture cannot fit the cap. No mainnet transaction has been signed or broadcast. The old eleven-call testnet rehearsal approval is exhausted. Existing callback recovery limitations still block unrestricted public deposits. No mainnet or integration completion claim without finalized evidence.

Publishing is authorized to the current signed-in accounts: GitHub `usamahabduljalil`, repository `YieldFund`; Vercel `usamahabduljalils-projects`. The initial hosted build uses public testnet reads with signing disabled. Mainnet activation requires a funded account, a deployable budget/design and a concrete reviewed transaction plan.

## UI

Preserve the existing design, concise copy and wallet-free landing. Inside the app add Campaigns, Create campaign and network selection. Cards show name, network, strategy, token and verification. Creation reviews show immutable destinations and exact cost. Unverified campaigns remain discoverable with a clear label.

This is a plan, not completion evidence. Update agent.md and the README capability table as each increment is verified.

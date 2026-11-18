# Direct Rhea and Trezu integration

Implementation started November 17, 2026, after the hackathon deadline. This work must not be represented as part of the earlier submitted/demo revision. Public hosting still shows the historical read-only testnet deployment.

## Rhea vault

Build with `bash scripts/build-rhea.sh`. Output is `artifacts/rhea/yieldfund_rhea_vault.wasm`; it never replaces the reviewed simulator artifacts. The `rhea` feature changes state layout and configuration. **Fresh deployment only; no in-place migration from any existing vault.**

The vault itself owns its Rhea lending position. Allocation uses standard `ft_transfer_call` with an empty message: supply only, no collateral or borrowing. Supporter exits and DAO donations use standard `ft_transfer`. The demo token's `*_once` extensions are not required by this artifact.

Redemption reads `get_account_all_positions` and `get_asset` directly from the configured lending contract. It checks account identity, absence of collateral/borrowing, a single allowed asset, withdrawal enablement and configured `extra_decimals`. It calls `simple_withdraw(token_id, amount_with_inner_decimal, recipient_id)` with the vault as recipient. The returned finalizer boolean authenticates the payment: `true` credits exactly the requested raw token amount; `false` means the protocol restored the lending position; missing/malformed/failed results remain locked. Balance increases alone never count as yield.

`continue_rhea_redemption(operation_id, version)` attaches 1 yoctoNEAR and **260 Tgas** (leaving headroom for Sputnik execution in a 300 Tgas transaction). It checks whether all lending shares are gone, or withdraws interest that accrued after the previous snapshot. Each call is bounded. Stale callbacks cannot send a second withdrawal. No eligible yield is unlocked until the position is empty. Fractional amounts below one token base unit remain explicitly unresolved; there is no dust write-off or operator force-success method. Initial live scope is `wrap.near`, with 24 token decimals and zero protocol extra decimals, subject to a fresh deployment preflight.

Allocation follows the standard token resolver's returned used amount. Unknown allocation and outgoing-payment callbacks remain locked: standard NEP-141 provides no durable transfer-receipt/cancellation extension. Existing simulator recovery is not falsely applied to a real token. This limitation must remain visible in any live release review.

## Evidence and reproduction

Rhea's public source at [`ref-finance/burrowland`, revision `2110c704`](https://github.com/ref-finance/burrowland/tree/2110c7047f2d72a9189abcbaad5eafb4e4a87f9e) documents the interface. It is version 0.15.7, while the deployed contract reports **0.16.2**. Its published release binary does **not** match deployed code. We do not claim source/build equivalence.

The compatibility test instead downloads and runs the **actual deployed mainnet Wasm** in an isolated local Sandbox, initialized with local accounts and a local standard token. Mainnet state and balances are not copied. Code is pinned at block **224957490**, hash `6twmEjFj4Wny7nNMvfQqLHkSJJEzL2sgNFYKJVAHcPZz`; account `contract.main.burrow.near`; code hash `6Nek1MZ8cwJJ2xMQAUWup9V5AToYS9rkTxJfwo6BCpFa`; SHA-256 `4fd64e59a0466cf3392ff1914959c59c7c086ed82300571c6e8fc89d9f7dede1`.

```powershell
./scripts/fetch-rhea-mainnet.ps1
```

Then in Linux/WSL with the documented Rust/Sandbox dependencies and baseline token/DAO artifacts:

```sh
bash scripts/test-rhea.sh
```

Tests and receipts are in `tests/integration/rhea.rs` and `docs/evidence/rhea-local-receipts/`. They are **local protocol compatibility evidence, not public mainnet transactions**. The integration suite tests the real lending binary and a standard NEP-141 binary; it does not substitute the YieldFund strategy simulator. Local borrower/oracle fixtures are identified in the test.

## Trezu

YieldFund uses Trezu's existing custom-proposal mechanism. Templates have fixed receiver, method, gas and deposit; members enter only method arguments. Templates cover:

- `verify_campaign`: exact metadata/evidence hashes and nanosecond expiry; called by the factory's verification DAO.
- `revoke_verification`: called by that same DAO.
- `distribute_yield`: for a vault whose fixed beneficiary and guardian are both the selected DAO.
- Rhea vault operations: `allocate_idle`, `redeem_strategy` and version-bound `continue_rhea_redemption`. These use the same DAO proposal/voting flow.

`scripts/export-trezu-templates.mjs` checks mainnet chain identity and reads the actual DAO policy, factory verifier, vault guardian/beneficiary and operation storage cost at one finalized block before exporting manifests. It never installs templates, signs, or broadcasts. Existing files are not overwritten.

Input file (public IDs only; replace placeholders):

```json
{
  "network": "mainnet",
  "rpcUrl": "https://rpc.mainnet.fastnear.com",
  "daoId": "YOUR_DAO.sputnik-dao.near",
  "factoryId": "YOUR_FACTORY.near",
  "vaultId": "YOUR_VAULT.near"
}
```

`factoryId` and `vaultId` are individually optional; at least one is required. A verifier DAO and beneficiary DAO may differ: export separate bundles with the corresponding ID.

```sh
node --experimental-strip-types scripts/export-trezu-templates.mjs public-config.json artifacts/trezu-export
```

Import at `https://trezu.app/<dao-id>/custom-templates/create`. Trezu requires membership and ChangePolicy permission to author templates. Its normal proposal and council-voting flow executes the underlying Sputnik call; the native payments flow handles treasury payments. A generated manifest is not evidence of a filed or paid proposal.

Schema compatibility is checked using Trezu's **unmodified** upstream schema from revision [`5694829`](https://github.com/NEAR-DevHub/trezu/tree/5694829ba441b9ef10ef34f0cfb3d09e0ad5f6ba):

```sh
# Fetch that exact revision into artifacts/integration-sources/trezu first.
npm install --prefix artifacts/trezu-compat --save-exact zod@4.4.3
node --experimental-strip-types scripts/check-trezu-compat.mjs
```

All six manifests passed; see `docs/evidence/trezu-template-compat.json`. Trezu's published connector lists mainnet only. Testnet treasury links are rejected rather than routed to an unrelated mainnet account. Actual Trezu import, proposal, voting and payment acceptance remain pending.

## Remaining release gates

The application now accepts an explicit `strategyMode: "rhea_lending"` manifest with `tokenSymbol` and `config.rhea_extra_decimals`. It reads the vault and Rhea account/asset at one finalized block and checks pinned code/config/policy. All token displays and inputs use configured precision (up to 24 decimals). Operations expose version-bound continuation only in Ready/Reading; unknown withdrawals stay locked. Mainnet treasury screens link to Trezu and DAO-controlled vaults export the four operation templates. Non-transfer proposals are filtered from the payment list and rejected by payment-detail actions. RPC/UI test fixtures do not count as live acceptance.

Remaining: controlled treasury DAO ID and sufficient operator funds; refreshed protocol/code/config checks; measured deployment/storage/gas budget and exact signing review; fresh Rhea vault deployment; live supply/redemption/interest/donation receipts; Trezu installation and wallet acceptance. Public mainnet signing is still disabled. The existing campaign factory still deploys simulator pairs and must not be relabeled as Rhea.

No mainnet spending occurred in this implementation. The previous mainnet spending deferral remains in force; the earlier 5 NEAR cap is not a renewed deployment approval.

# Funded strategy and DAO integration — milestone 3

This interface is implemented and exercised on ephemeral local NEAR Sandbox networks. It is a funded simulator, not Rhea lending. The browser still uses its labeled preview. No public deployment or wallet signing is configured.

## Immutable configuration and deployment

`Config.strategy_id` is optional. `null` keeps the idle-only path; a simulator account selects `funded_simulator`. Token, strategy, beneficiary, guardian and financial parameters cannot be changed. Initialize the vault and simulator from their own accounts, in the same deploy/init transaction for any eventual public deployment. This revision changes Borsh state: **fresh deployments only**; there is no migration from milestone 2.

The simulator is bound to one vault, one token, one controller and one fixed loss sink. The controller can fund simulated profit using actual tokens; no mint or arbitrary valuation exists. The separate controls Wasm additionally exposes partial acceptance, liquidity freeze and realized loss. Test controls are absent from the normal vault and simulator artifacts. All simulator artifacts remain test infrastructure.

## Vault calls

Amounts and IDs are integer JSON strings. Read `storage_costs().operation` for the permanent operation fee. Its extra yoctoNEAR covers an outgoing token call; the deployed contract must also retain enough native NEAR for repeated attempts and storage.

| Call | Access / deposit / minimum gas | Behavior |
| --- | --- | --- |
| `allocate_idle({amount})` | Guardian, operation fee, 160 Tgas | Reserve recognized idle cash; send to fixed strategy using `supply:<operation ID>` |
| `redeem_strategy({})` | Permissionless, operation fee, 220 Tgas | Fully redeem the strategy; one pending redemption ID at a time |
| `advance_operation({operation_id})` | Permissionless, 1 yoctoNEAR | 220 Tgas for delayed redemption; 110 Tgas for withdrawal/checkpoint/donation retries |
| `request_checkpoint({})` | Guardian, operation fee, 110 Tgas | Query fixed token after strategy is fully redeemed |
| `distribute_yield({max_amount})` | Guardian, operation fee, 110 Tgas | Reconcile cash, reserve at most eligible surplus, transfer only to immutable beneficiary |
| `request_withdraw({units,min_amount})` | Position owner, operation fee | May queue while strategy is allocated; processing requires full redemption |

Existing position, cancellation, pause, accounting and operation views remain available. `get_accounting` adds `strategy_book`, `settled`, `donated` and `queued_redemption`. `strategy_book` is accepted supply at book value, **not a live NAV**. Backing/shortfall while `settled=false` are book estimates and must not be presented as settlement quotes. Query the simulator for its position/busy state; realized losses are recognized only after full redemption. `eligible_yield` is zero while unsettled. `donated` counts callback-confirmed transfers, so it deliberately lags actual balances if a callback is interrupted.

## Provenance and settlement

1. Accepted deposits create idle cash and equal nominal units. Allocation is separate and creates no additional units. Deposits are rejected while allocated, active, paused or impaired.
2. The pinned standard token's completed resolver reports used supply. Unused tokens restore reserved cash exactly once; accepted tokens become `strategy_book`. Zero acceptance completes with all capital idle. Unknown outer failure stays locked because it can hide a successful strategy hook.
3. Profit uses `ft_transfer_call` from the configured controller, message `fund_profit`. It increases strategy position only after real tokens arrive. Plain transfers to the simulator do not increase position and cannot be redeemed as yield.
4. Test-only `realize_loss({amount})` reserves the position and transfers real tokens to the fixed sink. Confirmed failure restores position; unknown outcome locks. `set_controls({frozen,supply_limit})` is controller-only, one yoctoNEAR, and unavailable while busy.
5. A frozen redemption returns a typed `complete:false, amount:"0"` **before sending anything**. The vault safely queues that same operation for retry. It cannot be replaced by another redemption. A failed/invalid promise does not receive this treatment.
6. Full redemption returns tokens through `strategy_return:<ID>`. The vault authenticates token predecessor, strategy sender, active redemption and single receipt, then credits cash once. The strategy returns `complete:true` only after its position is zero and the token resolver completes. The private vault callback requires an exact match with hook-credited tokens.
7. Realized gains first repair outstanding backing. Proven eligible proceeds are reduced by losses and capped by `max(cash - nominal, 0)`. Donations additionally query the actual token balance, quarantine excess and reserve cash/proceeds before sending.
8. Supporter exits pay `floor(units × min(cash,nominal) / nominal)`. The last exit receives remaining backing. A zero payout is allowed only with a zero user minimum, burns the requested units without sending an invalid zero-token transfer, and emits completion. A minimum that cannot be met leaves units queued and cancellable.

Cash is already net of exclusions/reservations. Never subtract these twice. Direct unsolicited transfers to either contract are not eligible profit. Reallocation of remaining capital during impairment is guardian-authorized so the funded recovery scenario can operate; it does not enable deposits or donations during impairment. Pause blocks deposits, allocation and donation; requests, full redemption and safe exits remain available.

## Sputnik integration

Use the existing [Sputnik DAO contract](https://github.com/near-daos/sputnik-dao-contract/tree/5434a59dec23ee0c49df8c8c4350c208a7e75b0b), pinned to commit `5434a59dec23ee0c49df8c8c4350c208a7e75b0b` (package `sputnikdao2` 2.3.1). It is built from unmodified source and its own lockfile, using Rust 1.95.0. This is a local pinned-source build, not a claim of an audited/reproducible upstream release. `scripts/build-dao.sh` verifies archive and Wasm SHA-256. The upstream [license](https://github.com/near-daos/sputnik-dao-contract/blob/5434a59dec23ee0c49df8c8c4350c208a7e75b0b/LICENSE) applies; no custom multisig was introduced.

The Sandbox fixture creates three council accounts, `RoleWeight`, quorum `"2"`, absolute threshold `"2"`, a 0.1 NEAR proposal bond and seven-day proposal duration. Only council members can add transfer proposals, approve/reject them and finalize failed proposals. Supporters are not members. The treasury and recipient must be registered on the exact token.

`packages/near-client` builds unsigned `add_proposal` and `act_proposal` calls from the currently fetched DAO policy. Transfer proposals contain the fixed token, recipient, raw amount and `msg:null`. Votes include the exact fetched proposal kind so changed recipients/amounts fail contract validation. This helper is ready for wallet integration but is not wired into the preview UI and does not fetch, sign or submit transactions.

Two distinct votes trigger the DAO's existing token execution. The test asserts nested token receipts and recipient balance, not just the proposal status or outer transaction. An unregistered recipient produces `Failed`; registration plus a council `Finalize` retries once. Approved proposals cannot be voted/finalized again. The application must preserve the distinction between approval and a receipt-confirmed payment.

Trezu selected-network support has not been verified. No Trezu or live Rhea compatibility claim is made. The thin client targets the same existing Sputnik governance.

## Failure and authority limits

Missing callbacks after allocation/redemption/donation remain locked. There is no time-based unlock, admin-supplied NAV, force-success or generic recovery. Exact token receipts plus final contract state are necessary for diagnosis; balances alone are insufficient proof for replay. Unit tests cover unknown allocation/redemption outcomes; Sandbox faults cover actual payout/donation success followed by callback failure. Automated evidence-based recovery remains a release blocker.

The simulator and token are trusted pinned-code adapters. Public deployment must verify code, token registration, DAO policy and account authority before activation. Sandbox accounts retain full-access fixture keys; these can replace code or impersonate a contract predecessor. The DAO is self-initialized, so its reported factory is itself; its upgrade configuration plus retained keys are not a production governance setup. No public funds, security-audit claim or mainnet deployment is involved.

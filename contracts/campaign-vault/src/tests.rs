use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}
fn context(predecessor: &str, deposit: u128, result: Option<PromiseResult>) {
    context_at(predecessor, deposit, result, 0);
}
fn context_at(predecessor: &str, deposit: u128, result: Option<PromiseResult>, timestamp: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(account("vault.test"))
        .predecessor_account_id(account(predecessor))
        .signer_account_id(account("guardian.test")) // Must never authorize via signer.
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(timestamp)
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        result.into_iter().collect()
    );
}

#[test]
fn balance_recovery_supersedes_stale_callback_and_reserves_once() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    context("bob.test", 1, None);
    v.advance_operation(id).detach();
    let old = v.operation(id.0).version;
    assert!(std::panic::catch_unwind(
        std::panic::AssertUnwindSafe(|| v.recover_operation(id, old))
    )
    .is_err());
    context_at("bob.test", 1, None, RECOVERY_DELAY_NS);
    v.recover_operation(id, old).detach();
    let new = v.operation(id.0).version;
    assert_ne!(old, new);
    context_at(
        "vault.test",
        0,
        Some(PromiseResult::Successful(br#""1000""#.to_vec())),
        RECOVERY_DELAY_NS,
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.on_balance(id, old))).is_err()
    );
    v.on_balance(id, new).detach();
    assert_eq!((v.cash, v.nominal), (800, 800));
    assert_eq!(v.operation(id.0).payout, U128(200));
    assert_eq!(v.operation(id.0).stage, Stage::TransferPending);
}

#[test]
fn unknown_outgoing_payment_requires_durable_evidence_after_timeout() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    reconcile(&mut v, id, 1000);
    let version = v.operation(id.0).version;
    context_at("guardian.test", 1, None, RECOVERY_DELAY_NS);
    v.recover_operation(id, version).detach();
    let current = v.operation(id.0).version;
    context("vault.test", 0, Some(PromiseResult::Failed));
    assert!(!v.on_recovery_transfer(id, current));
    assert_eq!((v.cash, v.nominal), (800, 800));
    assert_eq!(v.active, Some(id.0));
}

fn pending_redemption() -> Vault {
    let mut v = vault();
    v.config.strategy_id = Some(account("strategy.test"));
    deposit(&mut v, 1000);
    v.cash = 0;
    v.strategy_book = 1000;
    context(
        "guardian.test",
        Vault::storage_cost(OPERATION_BYTES) + 1,
        None,
    );
    v.redeem_strategy().detach();
    v
}
fn proof(last: &str, busy: bool) -> PromiseResult {
    PromiseResult::Successful(
        near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
            "mode":"funded_simulator","token_id":"token.test","vault_id":"vault.test",
            "last_redeem":last,"return_sequence":"3","position":"0","busy":busy
        }))
        .unwrap(),
    )
}

#[test]
fn busy_recovery_preserves_late_return_and_success_never_credits_cash_twice() {
    let mut v = pending_redemption();
    let original = v.operation(1).version;
    context_at("bob.test", 1, None, RECOVERY_DELAY_NS);
    v.recover_operation(U64(1), original).detach();
    let version = v.operation(1).version;
    context_at("vault.test", 0, Some(proof("1", true)), RECOVERY_DELAY_NS);
    assert!(!v.on_recovery_redemption(U64(1), version));
    assert_eq!(v.operation(1).stage, Stage::Redeeming);
    assert_eq!(v.active, Some(1));
    context_at("token.test", 0, None, RECOVERY_DELAY_NS);
    assert_eq!(
        v.ft_on_transfer(
            account("strategy.test"),
            U128(1030),
            "strategy_return:1".into()
        ),
        U128(0)
    );
    let version = v.operation(1).version;
    context_at("bob.test", 1, None, 2 * RECOVERY_DELAY_NS);
    v.recover_operation(U64(1), version).detach();
    let current = v.operation(1).version;
    context_at(
        "vault.test",
        0,
        Some(proof("1", false)),
        2 * RECOVERY_DELAY_NS,
    );
    assert!(v.on_recovery_redemption(U64(1), current));
    assert_eq!(
        (v.cash, v.nominal, v.strategy_book, v.eligible),
        (1030, 1000, 0, 30)
    );
    assert_eq!(v.pending_redemption, None);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_redemption(U64(1), original)
    ))
    .is_err());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_recovery_redemption(U64(1), current)
    ))
    .is_err());
}

#[test]
fn missing_or_mismatched_redemption_proof_keeps_capital_locked() {
    let mut v = pending_redemption();
    let cases = [PromiseResult::Failed, proof("99", false),
        PromiseResult::Successful(br#"{"mode":"funded_simulator","token_id":"fake.test","vault_id":"vault.test","last_redeem":"1","position":"0","busy":false}"#.to_vec()),
        PromiseResult::Successful(br#"{"mode":"funded_simulator","token_id":"token.test","vault_id":"other.test","last_redeem":"1","position":"0","busy":false}"#.to_vec()),
        PromiseResult::Successful(br#"{"mode":"funded_simulator","token_id":"token.test","vault_id":"vault.test","last_redeem":"1","position":"10","busy":false}"#.to_vec()),
        PromiseResult::Successful(b"malformed".to_vec())];
    for (index, result) in cases.into_iter().enumerate() {
        let time = (index as u64 + 1) * RECOVERY_DELAY_NS;
        let version = v.operation(1).version;
        context_at("anyone.test", 1, None, time);
        v.recover_operation(U64(1), version).detach();
        let version = v.operation(1).version;
        context_at("vault.test", 0, Some(result), time);
        assert!(!v.on_recovery_redemption(U64(1), version));
        assert_eq!(
            (v.cash, v.nominal, v.strategy_book, v.eligible),
            (0, 1000, 1000, 0)
        );
        assert_eq!(v.active, Some(1));
    }
}
fn vault() -> Vault {
    context("vault.test", 0, None);
    Vault::new(Config {
        campaign_id: "commons".into(),
        token_id: account("token.test"),
        token_decimals: 6,
        beneficiary_id: account("dao.test"),
        guardian_id: account("guardian.test"),
        deposit_cap: U128(10_000),
        metadata_hash: "example".into(),
        disclosure_version: "1".into(),
        strategy_id: None,
    })
}
fn deposit(v: &mut Vault, amount: u128) {
    context("alice.test", Vault::storage_cost(POSITION_BYTES), None);
    v.storage_deposit(None);
    context("token.test", 0, None);
    assert_eq!(
        v.ft_on_transfer(account("alice.test"), U128(amount), "deposit".into()),
        U128(0)
    );
}
fn request(v: &mut Vault, units: u128) -> U64 {
    context("alice.test", Vault::storage_cost(OPERATION_BYTES) + 1, None);
    v.request_withdraw(U128(units), U128(units))
}
fn reconcile(v: &mut Vault, id: U64, balance: u128) {
    context("anyone.test", 1, None);
    v.advance_operation(id).detach();
    let version = v.operation(id.0).version;
    context(
        "vault.test",
        0,
        Some(PromiseResult::Successful(
            format!("\"{balance}\"").into_bytes(),
        )),
    );
    v.on_balance(id, version).detach();
}

#[test]
fn rejected_deposits_return_unused_without_credit() {
    let mut v = vault();
    context("token.test", 0, None);
    assert_eq!(
        v.ft_on_transfer(account("alice.test"), U128(100), "deposit".into()),
        U128(100)
    );
    assert_eq!(v.nominal, 0);
    deposit(&mut v, 1000);
    assert_eq!((v.cash, v.nominal), (1000, 1000));
    assert_eq!(
        v.ft_on_transfer(account("alice.test"), U128(10_000), "deposit".into()),
        U128(10_000)
    );
    assert_eq!(
        v.ft_on_transfer(account("alice.test"), U128(1), "unknown".into()),
        U128(1)
    );
    assert_eq!(v.nominal, 1000);
}

#[test]
#[should_panic(expected = "unsupported token")]
fn fake_token_cannot_credit_position() {
    let mut v = vault();
    context("fake.test", 0, None);
    v.ft_on_transfer(account("alice.test"), U128(100), "deposit".into());
}

#[test]
#[should_panic(expected = "guardian only")]
fn guardian_signer_does_not_authorize_contract_predecessor() {
    let mut v = vault();
    context("attacker.test", 1, None);
    v.set_paused(true);
}

#[test]
fn pending_units_stay_in_denominator_until_payout_and_finalize_once() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    assert_eq!(v.nominal, 1000);
    assert_eq!(
        v.positions.get(&account("alice.test")).unwrap().reserved.0,
        200
    );
    reconcile(&mut v, id, 1000);
    assert_eq!((v.cash, v.nominal), (800, 800));
    assert_eq!(v.get_accounting().reserved_outbound.0, 200);
    let version = v.operation(id.0).version;
    context("vault.test", 0, Some(payment_proof(&v, id, true)));
    assert!(v.on_transfer(id, version));
    assert!(v.active.is_none());
    assert_eq!(v.operation(id.0).stage, Stage::Completed);
    assert_eq!(
        v.positions.get(&account("alice.test")).unwrap().withdrawn.0,
        200
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.on_transfer(id, version)))
            .is_err()
    );
    assert_eq!((v.cash, v.nominal), (800, 800));
}

#[test]
fn failed_transfer_restores_once_then_owner_can_cancel() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    reconcile(&mut v, id, 1000);
    let version = v.operation(id.0).version;
    context("vault.test", 0, Some(PromiseResult::Failed));
    assert!(!v.on_transfer(id, version));
    assert_eq!((v.cash, v.nominal), (1000, 1000));
    let p = v.positions.get(&account("alice.test")).unwrap();
    assert_eq!((p.nominal.0, p.reserved.0, p.withdrawn.0), (1000, 200, 0));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.on_transfer(id, version)))
            .is_err()
    );
    context("alice.test", 1, None);
    v.cancel_withdraw(id);
    assert_eq!(
        v.positions.get(&account("alice.test")).unwrap().reserved.0,
        0
    );
}

#[test]
fn untrusted_excess_never_becomes_yield_or_reduces_principal_on_refund() {
    let mut v = vault();
    deposit(&mut v, 1000);
    for excess in [500, 0] {
        context(
            "guardian.test",
            Vault::storage_cost(OPERATION_BYTES) + 1,
            None,
        );
        v.request_checkpoint().detach();
        let id = v.active.unwrap();
        let version = v.operation(id).version;
        context(
            "vault.test",
            0,
            Some(PromiseResult::Successful(
                format!("\"{}\"", 1000 + excess).into_bytes(),
            )),
        );
        v.on_balance(U64(id), version).detach();
        assert_eq!((v.cash, v.excluded), (1000, excess));
        assert_eq!(v.get_accounting().eligible_yield.0, 0);
    }
}

#[test]
fn unknown_shortfall_locks_without_destroying_accounting() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    reconcile(&mut v, id, 900);
    assert_eq!(v.operation(id.0).stage, Stage::NeedsReconciliation);
    assert_eq!((v.cash, v.nominal), (1000, 1000));
    assert_eq!(v.active, Some(id.0));
    context("token.test", 0, None);
    assert_eq!(
        v.ft_on_transfer(account("alice.test"), U128(10), "deposit".into()),
        U128(10)
    );
}

#[test]
fn read_failure_is_retryable_but_stale_callback_is_not() {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    context("anyone.test", 1, None);
    v.advance_operation(id).detach();
    let old_version = v.operation(id.0).version;
    context("vault.test", 0, Some(PromiseResult::Failed));
    v.on_balance(id, old_version).detach();
    assert_eq!(v.operation(id.0).stage, Stage::RetryableFailure);
    context("anyone.test", 1, None);
    v.advance_operation(id).detach();
    context(
        "vault.test",
        0,
        Some(PromiseResult::Successful(b"\"1000\"".to_vec())),
    );
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_balance(id, old_version)
    ))
    .is_err());
    assert_eq!(v.operation(id.0).stage, Stage::Reconciling);
}

#[test]
fn paid_storage_covers_maximum_ids_and_operation_growth() {
    let mut v = vault();
    let long = "a".repeat(64);
    context(&long, Vault::storage_cost(POSITION_BYTES), None);
    assert!(v.storage_deposit(None));
    context("token.test", 0, None);
    assert_eq!(
        v.ft_on_transfer(account(&long), U128(100), "deposit".into()),
        U128(0)
    );
    context(&long, Vault::storage_cost(OPERATION_BYTES) + 1, None);
    let before = env::storage_usage();
    let id = v.request_withdraw(U128(100), U128(100));
    let mut op = v.operation(id.0);
    op.error = Some("x".repeat(64));
    v.save_operation(&mut op);
    assert!(u128::from(env::storage_usage() - before) <= OPERATION_BYTES);
}

#[test]
fn unknown_allocation_result_cannot_restore_or_replay_cash() {
    let mut v = vault();
    v.config.strategy_id = Some(account("strategy.test"));
    deposit(&mut v, 1000);
    context(
        "guardian.test",
        Vault::storage_cost(OPERATION_BYTES) + 1,
        None,
    );
    v.allocate_idle(U128(1000)).detach();
    let version = v.operation(1).version;
    context("vault.test", 0, Some(PromiseResult::Failed));
    assert!(!v.on_allocation(U64(1), version));
    assert_eq!(v.cash, 0);
    assert_eq!(v.nominal, 1000);
    assert_eq!(v.operation(1).stage, Stage::NeedsReconciliation);
    assert_eq!(v.active, Some(1));
}

#[test]
fn strategy_return_is_bound_to_sender_operation_and_single_credit() {
    let mut v = vault();
    v.config.strategy_id = Some(account("strategy.test"));
    deposit(&mut v, 1000);
    v.cash = 0;
    v.strategy_book = 1000;
    context(
        "guardian.test",
        Vault::storage_cost(OPERATION_BYTES) + 1,
        None,
    );
    v.redeem_strategy().detach();
    let version = v.operation(1).version;
    context("token.test", 0, None);
    assert_eq!(
        v.ft_on_transfer(
            account("alice.test"),
            U128(1030),
            "strategy_return:1".into()
        ),
        U128(1030)
    );
    assert_eq!(
        v.ft_on_transfer(
            account("strategy.test"),
            U128(1030),
            "strategy_return:2".into()
        ),
        U128(1030)
    );
    assert_eq!(
        v.ft_on_transfer(
            account("strategy.test"),
            U128(1030),
            "strategy_return:1".into()
        ),
        U128(0)
    );
    assert_eq!(
        v.ft_on_transfer(
            account("strategy.test"),
            U128(1030),
            "strategy_return:1".into()
        ),
        U128(1030)
    );
    assert_eq!(v.cash, 1030);
    context(
        "vault.test",
        0,
        Some(PromiseResult::Successful(
            br#"{"complete":true,"amount":"1030"}"#.to_vec(),
        )),
    );
    assert!(v.on_redemption(U64(1), version));
    assert_eq!(v.strategy_book, 0);
    assert_eq!(v.eligible, 30);
    assert_eq!(v.nominal, 1000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_redemption(U64(1), version)
    ))
    .is_err());
}

#[test]
fn redemption_failure_after_return_keeps_cash_locked_and_yield_ineligible() {
    let mut v = vault();
    v.config.strategy_id = Some(account("strategy.test"));
    deposit(&mut v, 1000);
    v.cash = 0;
    v.strategy_book = 1000;
    context(
        "guardian.test",
        Vault::storage_cost(OPERATION_BYTES) + 1,
        None,
    );
    v.redeem_strategy().detach();
    let version = v.operation(1).version;
    context("token.test", 0, None);
    v.ft_on_transfer(
        account("strategy.test"),
        U128(1030),
        "strategy_return:1".into(),
    );
    context("vault.test", 0, Some(PromiseResult::Failed));
    assert!(!v.on_redemption(U64(1), version));
    assert_eq!(v.active, Some(1));
    assert_eq!(v.cash, 1030);
    assert_eq!(v.get_accounting().eligible_yield.0, 0);
}

fn payment_proof(v: &Vault, id: U64, applied: bool) -> PromiseResult {
    let op = v.operation(id.0);
    PromiseResult::Successful(
        near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
            "sender_id":"vault.test","receiver_id":op.owner_id,"amount":op.payout,
            "sequence":U64(v.pending_transfer_sequence),"applied":applied
        }))
        .unwrap(),
    )
}
fn check_payment_recovery(applied: bool) {
    let mut v = vault();
    deposit(&mut v, 1000);
    let id = request(&mut v, 200);
    reconcile(&mut v, id, 1000);
    let original = v.operation(id.0).version;
    let sequence = v.pending_transfer_sequence;
    context_at("bob.test", 1, None, RECOVERY_DELAY_NS);
    v.recover_operation(id, original).detach();
    let current = v.operation(id.0).version;
    assert_eq!(sequence, v.pending_transfer_sequence);
    context("vault.test", 0, Some(payment_proof(&v, id, applied)));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| v.on_transfer(id, original)))
            .is_err()
    );
    assert_eq!(v.on_recovery_transfer(id, current), applied);
    assert_eq!(v.cash, if applied { 800 } else { 1000 });
    assert_eq!(v.nominal, if applied { 800 } else { 1000 });
    assert_eq!(
        v.positions.get(&account("alice.test")).unwrap().withdrawn.0,
        if applied { 200 } else { 0 }
    );
    assert!(v.active.is_none());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_recovery_transfer(id, current)
    ))
    .is_err());
}
#[test]
fn paid_recovery_is_exactly_once() {
    check_payment_recovery(true);
}
#[test]
fn cancelled_recovery_is_exactly_once() {
    check_payment_recovery(false);
}

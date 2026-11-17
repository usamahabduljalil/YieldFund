use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

fn context(result: Option<&[u8]>) {
    results_context(
        result
            .into_iter()
            .map(|b| PromiseResult::Successful(b.to_vec()))
            .collect(),
    );
}
fn account_context(bytes: &[u8], decimals: u8) {
    let asset = near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
        "token_id":"token.test", "config":{"extra_decimals":decimals, "can_withdraw":true}
    }))
    .unwrap();
    results_context(vec![
        PromiseResult::Successful(bytes.to_vec()),
        PromiseResult::Successful(asset),
    ]);
}
fn results_context(results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("vault.test".parse().unwrap())
        .predecessor_account_id("vault.test".parse().unwrap())
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(100));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn vault() -> Vault {
    context(None);
    let mut v = Vault::new(Config {
        campaign_id: "rhea".into(),
        token_id: "token.test".parse().unwrap(),
        token_decimals: 6,
        beneficiary_id: "dao.test".parse().unwrap(),
        guardian_id: "guardian.test".parse().unwrap(),
        deposit_cap: U128(10_000),
        metadata_hash: "test".into(),
        disclosure_version: "rhea-v1".into(),
        strategy_id: Some("rhea.test".parse().unwrap()),
        rhea_extra_decimals: 0,
    });
    v.nominal = 1000;
    v.strategy_book = 1000;
    let mut op = v.new_operation(
        Kind::Redemption,
        "caller.test".parse().unwrap(),
        U128(1000),
        U128(0),
    );
    op.stage = Stage::Redeeming;
    v.save_operation(&mut op);
    v.active = Some(op.id.0);
    v.pending_redemption = Some(op.id.0);
    v.rhea_phase = Phase::Withdrawing;
    v.rhea_pending_amount = 1030;
    v
}
fn result(v: &mut Vault, bytes: &[u8]) {
    let op = v.operation(1);
    context(Some(bytes));
    v.on_rhea_withdraw(op.id, op.version);
}
#[test]
fn return_is_credited_once_and_yield_waits_for_empty_position() {
    let mut v = vault();
    let old = v.operation(1).version;
    result(&mut v, b"true");
    assert_eq!((v.cash, v.eligible, v.strategy_book), (1030, 0, 1000));
    assert_eq!(v.active, Some(1));
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
        || v.on_rhea_withdraw(U64(1), old)
    ))
    .is_err());
    v.rhea_phase = Phase::Reading;
    let op = v.operation(1);
    account_context(
        br#"{"account_id":"vault.test","supplied":[],"positions":{},"is_locked":false}"#,
        0,
    );
    v.on_rhea_account(op.id, op.version).detach();
    assert_eq!((v.cash, v.eligible, v.strategy_book), (1030, 30, 0));
    assert!(v.active.is_none());
}
#[test]
fn protocol_false_retries_but_unknown_never_unlocks() {
    let mut v = vault();
    result(&mut v, b"false");
    assert_eq!((v.cash, v.rhea_phase), (0, Phase::Ready));
    v.rhea_phase = Phase::Withdrawing;
    v.rhea_pending_amount = 1030;
    result(&mut v, b"null");
    assert_eq!((v.cash, v.rhea_phase), (0, Phase::Unknown));
    assert_eq!(v.active, Some(1));
}
#[test]
fn nonzero_position_cannot_be_settled_as_fully_redeemed() {
    let mut v = vault();
    result(&mut v, b"true");
    v.rhea_phase = Phase::Reading;
    let op = v.operation(1);
    account_context(br#"{"account_id":"vault.test","supplied":[{"token_id":"token.test","balance":"2","shares":"1"}],"positions":{},"is_locked":false}"#, 0);
    v.on_rhea_account(op.id, op.version).detach();
    assert_eq!(v.rhea_pending_amount, 2);
    assert_eq!(v.rhea_phase, Phase::Withdrawing);
    assert_eq!(v.eligible, 0);
}
#[test]
fn wrong_owner_or_borrowing_evidence_never_sends_a_withdrawal() {
    let mut v = vault();
    for bytes in [
        br#"{"account_id":"attacker.test","supplied":[],"positions":{},"is_locked":false}"#.as_slice(),
        br#"{"account_id":"vault.test","supplied":[],"positions":{"REGULAR":{"collateral":[],"borrowed":[{"token_id":"token.test","balance":"1","shares":"1"}]}},"is_locked":false}"#.as_slice(),
        b"null".as_slice(),
    ] {
        v.rhea_phase = Phase::Reading;
        let op = v.operation(1);
        account_context(bytes, 0);
        v.on_rhea_account(op.id, op.version).detach();
        assert_eq!(v.rhea_phase, Phase::Ready);
        assert_eq!(v.active, Some(1));
        assert_eq!(v.strategy_book, 1000);
    }
}
#[test]
fn sub_token_dust_stays_locked_and_is_not_invented_as_cash() {
    let mut v = vault();
    v.config.rhea_extra_decimals = 6;
    v.rhea_phase = Phase::Reading;
    let op = v.operation(1);
    account_context(br#"{"account_id":"vault.test","supplied":[{"token_id":"token.test","balance":"999","shares":"999"}],"positions":{},"is_locked":false}"#, 6);
    v.on_rhea_account(op.id, op.version).detach();
    assert_eq!(v.cash, 0);
    assert_eq!(
        v.operation(1).error.as_deref(),
        Some("rhea_sub_token_dust_remaining")
    );
}

#[test]
fn changed_protocol_precision_cannot_credit_the_wrong_amount() {
    let mut v = vault();
    v.rhea_phase = Phase::Reading;
    let op = v.operation(1);
    account_context(br#"{"account_id":"vault.test","supplied":[{"token_id":"token.test","balance":"1000","shares":"1000"}],"positions":{},"is_locked":false}"#, 6);
    v.on_rhea_account(op.id, op.version).detach();
    assert_eq!(v.rhea_phase, Phase::Ready);
    assert_eq!(v.cash, 0);
}

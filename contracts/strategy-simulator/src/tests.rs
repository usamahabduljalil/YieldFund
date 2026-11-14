use super::*;
use near_sdk::{test_utils::VMContextBuilder, testing_env, PromiseResult};

fn context(actor: &str, result: Option<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("strategy.test".parse().unwrap())
        .predecessor_account_id(actor.parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1))
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
fn unexecuted_redemption_is_fenced_and_old_callbacks_cannot_finish_a_retry() {
    context("strategy.test", None);
    let mut s = Simulator::new(
        "token.test".parse().unwrap(),
        "vault.test".parse().unwrap(),
        "guardian.test".parse().unwrap(),
        "sink.test".parse().unwrap(),
    );
    s.position = 1000;
    context("vault.test", None);
    s.recover_position(U64(1), U64(7)).detach();
    assert_eq!(s.position, 1000);
    assert_eq!(s.return_used, Some(0));
    assert!(std::panic::catch_unwind(
        std::panic::AssertUnwindSafe(|| s.redeem_all(U64(1), U64(7)))
    )
    .is_err());
    s.redeem_all(U64(1), U64(8)).detach();
    assert!(s.busy);
    let proof = near_sdk::serde_json::json!({"sender_id":"strategy.test","receiver_id":"vault.test","sequence":"8","amount":"1000","msg":"strategy_return:1","used":"1000"});
    context(
        "strategy.test",
        Some(PromiseResult::Successful(proof.to_string().into_bytes())),
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.on_return(
            U64(1),
            U128(1000),
            U64(7)
        )))
        .is_err()
    );
    s.on_recover_return(U64(1), U64(8));
    assert!(!s.busy);
    assert_eq!(s.position, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.on_return(
            U64(1),
            U128(1000),
            U64(8)
        )))
        .is_err()
    );
}

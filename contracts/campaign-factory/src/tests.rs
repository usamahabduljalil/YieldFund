use super::*;
use near_sdk::{
    test_utils::{get_created_receipts, VMContextBuilder},
    testing_env, PromiseResult,
};

fn context(actor: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("factory.test".parse().unwrap())
        .predecessor_account_id(actor.parse().unwrap())
        .signer_account_id("impostor.test".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(time);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn factory() -> Factory {
    context("factory.test", 0, 0, vec![]);
    Factory::new(
        "verification-dao.test".parse().unwrap(),
        "token.test".parse().unwrap(),
        6,
        U128(1250000000000000000000),
    )
}
fn create(f: &mut Factory, actor: &str, id: &str) {
    context(actor, f.creation_cost().0, 1, vec![]);
    f.create_campaign(
        id.into(),
        format!("Campaign {id}"),
        "treasury.test".parse().unwrap(),
        "a".repeat(64),
        U128(1_000_000_000),
    )
    .detach();
}
fn ready(f: &mut Factory, id: &str) {
    context(
        "factory.test",
        0,
        2,
        vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Successful(vec![]),
        ],
    );
    assert!(f.on_created(id.into()));
    context(
        "factory.test",
        0,
        3,
        (0..3)
            .map(|_| PromiseResult::Successful(b"{}".to_vec()))
            .collect(),
    );
    assert!(f.on_registered(id.into()));
}
#[test]
fn permissionless_creation_is_isolated_and_keyless() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    let receipts = format!("{:?}", get_created_receipts());
    assert!(!receipts.contains("AddKey"));
    create(&mut f, "bob.test", "beta");
    let a = f.get_campaign("alpha".into()).unwrap();
    let b = f.get_campaign("beta".into()).unwrap();
    assert_ne!(a.vault_id, b.vault_id);
    assert_ne!(a.strategy_id, b.strategy_id);
    assert_eq!(a.creator_id.as_str(), "alice.test");
    assert_eq!(b.creator_id.as_str(), "bob.test");
    assert!(!f.is_verified("alpha".into()));
    assert_eq!(f.list_campaigns(U64(1), 1)[0].id, "beta");
}
#[test]
fn registration_must_finish_before_ready() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    assert_eq!(
        f.get_campaign("alpha".into()).unwrap().status,
        CreationStatus::Creating
    );
    ready(&mut f, "alpha");
    assert_eq!(
        f.get_campaign("alpha".into()).unwrap().status,
        CreationStatus::Ready
    );
}
#[test]
fn failed_child_never_appears_ready_and_cannot_be_replayed() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    context(
        "factory.test",
        0,
        2,
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed],
    );
    assert!(!f.on_created("alpha".into()));
    assert_eq!(
        f.get_campaign("alpha".into()).unwrap().status,
        CreationStatus::Failed
    );
    assert!(std::panic::catch_unwind(
        std::panic::AssertUnwindSafe(|| f.on_created("alpha".into()))
    )
    .is_err());
}
#[test]
fn failed_registration_never_appears_ready() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    context(
        "factory.test",
        0,
        2,
        vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Successful(vec![]),
        ],
    );
    f.on_created("alpha".into());
    context(
        "factory.test",
        0,
        3,
        vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Failed,
            PromiseResult::Successful(vec![]),
        ],
    );
    assert!(!f.on_registered("alpha".into()));
    assert!(!f.is_verified("alpha".into()));
}
#[test]
fn dao_attestation_is_bound_to_metadata_expires_and_can_be_revoked() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    ready(&mut f, "alpha");
    context("verification-dao.test", 1, 4, vec![]);
    f.verify_campaign("alpha".into(), "a".repeat(64), "b".repeat(64), U64(10));
    assert!(f.is_verified("alpha".into()));
    context("alice.test", 0, 10, vec![]);
    assert!(!f.is_verified("alpha".into()));
    context("verification-dao.test", 1, 11, vec![]);
    f.verify_campaign("alpha".into(), "a".repeat(64), "b".repeat(64), U64(20));
    f.revoke_verification("alpha".into());
    assert!(!f.is_verified("alpha".into()));
}
#[test]
#[should_panic(expected = "verifier only")]
fn creator_cannot_self_verify() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    ready(&mut f, "alpha");
    context("alice.test", 1, 4, vec![]);
    f.verify_campaign("alpha".into(), "a".repeat(64), "b".repeat(64), U64(10));
}
#[test]
#[should_panic(expected = "campaign already exists")]
fn ids_cannot_be_reused() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    create(&mut f, "bob.test", "alpha");
}
#[test]
fn validates_slugs_hashes_and_pagination() {
    for id in [
        "",
        "../x",
        "a.b",
        "A",
        "-a",
        "a-",
        "abcdefghijklmnopqrstuvwxyz",
    ] {
        assert!(!valid_id(id));
    }
    assert!(valid_id("community-2"));
    assert!(!valid_hash(&"G".repeat(64)));
    let f = factory();
    assert!(f.list_campaigns(U64(u64::MAX), 50).is_empty());
}

#[test]
#[should_panic(expected = "metadata changed")]
fn dao_cannot_attest_different_metadata() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    ready(&mut f, "alpha");
    context("verification-dao.test", 1, 4, vec![]);
    f.verify_campaign("alpha".into(), "c".repeat(64), "b".repeat(64), U64(10));
}

#[test]
#[should_panic(expected = "verifier only")]
fn creator_cannot_revoke_dao_verification() {
    let mut f = factory();
    create(&mut f, "alice.test", "alpha");
    ready(&mut f, "alpha");
    context("verification-dao.test", 1, 4, vec![]);
    f.verify_campaign("alpha".into(), "a".repeat(64), "b".repeat(64), U64(10));
    context("alice.test", 1, 5, vec![]);
    f.revoke_verification("alpha".into());
}

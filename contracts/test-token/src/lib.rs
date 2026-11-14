//! Test-only fixed-supply token with NEP-141 interfaces and durable receipt extensions.
//! Journal users keep their paid registration permanently. No mint or clawback.
use near_contract_standards::fungible_token::{
    core::FungibleTokenCore,
    events::FtMint,
    metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC},
    receiver::ext_ft_receiver,
    resolver::FungibleTokenResolver,
    FungibleToken,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::{
    assert_one_yocto,
    collections::LookupMap,
    env, ext_contract,
    json_types::{U128, U64},
    near, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue,
};

/// One bounded durable receipt per registered sender. Sequence numbers fence late calls.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TransferReceipt {
    pub sender_id: AccountId,
    pub receiver_id: AccountId,
    pub sequence: U64,
    pub amount: U128,
    pub applied: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CallReceipt {
    pub sender_id: AccountId,
    pub receiver_id: AccountId,
    pub sequence: U64,
    pub amount: U128,
    pub msg: String,
    pub used: Option<U128>,
}
#[allow(dead_code)]
#[ext_contract(tracked)]
trait TrackedResolver {
    fn ft_resolve_tracked(&mut self, sender_id: AccountId, sequence: U64) -> U128;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
    transfers: LookupMap<AccountId, TransferReceipt>,
    calls: LookupMap<AccountId, CallReceipt>,
}

#[near]
impl TestToken {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        assert!(total_supply.0 > 0, "zero supply");
        let mut token = FungibleToken::new(b"t".to_vec());
        // NEP-145 registration pays for the largest possible receipt, including map keys.
        token.account_storage_usage += 2048;
        token.internal_register_account(&owner_id);
        token.internal_deposit(&owner_id, total_supply.0);
        FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("Sandbox fixture supply"),
        }
        .emit();
        Self {
            token,
            transfers: LookupMap::new(b"r"),
            calls: LookupMap::new(b"c"),
        }
    }

    /// Test-token extension, NOT part of NEP-141. Balance movement and evidence
    /// commit in the same receipt. Replays cannot move tokens a second time.
    #[payable]
    pub fn ft_transfer_once(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
    ) -> TransferReceipt {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        if let Some(existing) = self.match_receipt(&sender, &receiver_id, amount, sequence) {
            return existing;
        }
        self.token
            .internal_transfer(&sender, &receiver_id, amount.0, None);
        self.record(sender, receiver_id, amount, sequence, true)
    }

    /// Return the atomic result, or cancel an absent attempt BEFORE restoring a
    /// vault reservation. A delayed original call then observes applied=false.
    #[payable]
    pub fn ft_resolve_once(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
    ) -> TransferReceipt {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        if let Some(existing) = self.match_receipt(&sender, &receiver_id, amount, sequence) {
            return existing;
        }
        assert!(
            self.token.accounts.contains_key(&sender),
            "sender not registered"
        );
        self.record(sender, receiver_id, amount, sequence, false)
    }

    pub fn get_transfer_receipt(&self, sender_id: AccountId) -> Option<TransferReceipt> {
        self.transfers.get(&sender_id)
    }

    #[payable]
    pub fn ft_transfer_call_once(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_one_yocto();
        assert!(sequence.0 > 0 && msg.len() <= 128, "invalid tracked call");
        let sender = env::predecessor_account_id();
        if let Some(old) = self.calls.get(&sender) {
            assert!(
                old.used.is_some() && sequence.0 > old.sequence.0,
                "tracked call pending or stale"
            );
        }
        let before = env::storage_usage();
        self.token
            .internal_transfer(&sender, &receiver_id, amount.0, None);
        self.calls.insert(
            &sender,
            &CallReceipt {
                sender_id: sender.clone(),
                receiver_id: receiver_id.clone(),
                sequence,
                amount,
                msg: msg.clone(),
                used: None,
            },
        );
        assert!(
            env::storage_usage().saturating_sub(before) <= 1024,
            "call receipt storage budget exceeded"
        );
        return ext_ft_receiver::ext(receiver_id)
            .with_unused_gas_weight(1)
            .ft_on_transfer(sender.clone(), amount, msg)
            .then(
                tracked::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .with_unused_gas_weight(0)
                    .ft_resolve_tracked(sender, sequence),
            )
            .into();
    }

    pub fn get_transfer_call_receipt(&self, sender_id: AccountId) -> Option<CallReceipt> {
        self.calls.get(&sender_id)
    }

    #[payable]
    pub fn ft_resolve_call_intent(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
        msg: String,
    ) -> CallReceipt {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        assert!(
            sequence.0 > 0 && amount.0 > 0 && msg.len() <= 128,
            "invalid tracked call"
        );
        assert!(
            self.token.accounts.contains_key(&sender),
            "sender not registered"
        );
        if let Some(old) = self.calls.get(&sender) {
            assert!(sequence.0 >= old.sequence.0, "stale tracked call");
            if sequence == old.sequence {
                assert!(
                    old.receiver_id == receiver_id && old.amount == amount && old.msg == msg,
                    "call intent changed"
                );
                return old;
            }
            assert!(old.used.is_some(), "prior call pending");
        }
        let r = CallReceipt {
            sender_id: sender.clone(),
            receiver_id,
            sequence,
            amount,
            msg,
            used: Some(U128(0)),
        };
        let before = env::storage_usage();
        self.calls.insert(&sender, &r);
        assert!(
            env::storage_usage().saturating_sub(before) <= 1024,
            "call receipt storage budget exceeded"
        );
        r
    }

    #[private]
    pub fn ft_resolve_tracked(&mut self, sender_id: AccountId, sequence: U64) -> U128 {
        let mut r = self.calls.get(&sender_id).expect("missing tracked call");
        assert_eq!(r.sequence, sequence, "stale resolver");
        if let Some(used) = r.used {
            return used;
        }
        // Refund and evidence are one atomic state update. No later recorder callback.
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, r.receiver_id.clone(), r.amount);
        assert_eq!(burned, 0, "tracked sender cannot unregister");
        r.used = Some(U128(used));
        self.calls.insert(&sender_id, &r);
        U128(used)
    }

    fn match_receipt(
        &self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: U128,
        sequence: U64,
    ) -> Option<TransferReceipt> {
        assert!(sequence.0 > 0 && amount.0 > 0, "invalid transfer intent");
        if let Some(r) = self.transfers.get(sender) {
            assert!(sequence.0 >= r.sequence.0, "stale transfer sequence");
            if r.sequence == sequence {
                assert!(
                    r.receiver_id == *receiver && r.amount == amount,
                    "transfer intent changed"
                );
                return Some(r);
            }
        }
        None
    }
    fn record(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
        applied: bool,
    ) -> TransferReceipt {
        let r = TransferReceipt {
            sender_id: sender_id.clone(),
            receiver_id,
            amount,
            sequence,
            applied,
        };
        let before = env::storage_usage();
        self.transfers.insert(&sender_id, &r);
        assert!(
            env::storage_usage().saturating_sub(before) <= 1024,
            "receipt storage budget exceeded"
        );
        r
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }
    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }
    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }
    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        assert!(
            !self.calls.contains_key(&env::predecessor_account_id()),
            "durable call fence requires registration"
        );
        assert!(
            !self.transfers.contains_key(&env::predecessor_account_id()),
            "durable transfer fence requires registration"
        );
        self.token.storage_unregister(force)
    }
    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }
    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "YieldFund Sandbox Token".into(),
            symbol: "tUSD".into(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn context(actor: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id("token.test".parse().unwrap())
            .predecessor_account_id(actor.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    #[test]
    fn atomic_payment_receipt_is_idempotent_and_cancellation_fences_late_calls() {
        context("alice.test", 0);
        let mut t = TestToken::new("alice.test".parse().unwrap(), U128(1000));
        context("bob.test", NearToken::from_near(1).as_yoctonear());
        t.storage_deposit(None, Some(true));
        context("alice.test", 1);
        let bob: AccountId = "bob.test".parse().unwrap();
        assert!(t.ft_transfer_once(bob.clone(), U128(200), U64(1)).applied);
        assert!(t.ft_transfer_once(bob.clone(), U128(200), U64(1)).applied);
        assert!(t.ft_resolve_once(bob.clone(), U128(200), U64(1)).applied);
        assert_eq!(t.ft_balance_of(bob.clone()), U128(200));
        assert!(!t.ft_resolve_once(bob.clone(), U128(100), U64(2)).applied);
        assert!(!t.ft_transfer_once(bob.clone(), U128(100), U64(2)).applied);
        assert_eq!(t.ft_balance_of(bob.clone()), U128(200));
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.ft_transfer_once(
                bob.clone(),
                U128(101),
                U64(2)
            )))
            .is_err()
        );
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| t.ft_transfer_once(
                bob.clone(),
                U128(200),
                U64(1)
            )))
            .is_err()
        );
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || t.storage_unregister(Some(true))
        ))
        .is_err());
        assert!(t.ft_transfer_once(bob.clone(), U128(100), U64(3)).applied);
        assert_eq!(t.ft_balance_of(bob), U128(300));
    }

    #[test]
    fn cancelled_call_cannot_transfer_and_resolver_commits_refund_once() {
        use near_sdk::PromiseResult;
        context("alice.test", 0);
        let alice: AccountId = "alice.test".parse().unwrap();
        let bob: AccountId = "bob.test".parse().unwrap();
        let mut t = TestToken::new(alice.clone(), U128(1000));
        context("bob.test", NearToken::from_near(1).as_yoctonear());
        t.storage_deposit(None, Some(true));
        context("alice.test", 1);
        assert_eq!(
            t.ft_resolve_call_intent(bob.clone(), U128(100), U64(1), "supply:1".into())
                .used,
            Some(U128(0))
        );
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || t.ft_transfer_call_once(bob.clone(), U128(100), U64(1), "supply:1".into())
        ))
        .is_err());
        assert_eq!(t.ft_balance_of(bob.clone()), U128(0));
        t.ft_transfer_call_once(bob.clone(), U128(100), U64(2), "supply:2".into())
            .detach();
        assert_eq!(
            t.ft_resolve_call_intent(bob.clone(), U128(100), U64(2), "supply:2".into())
                .used,
            None
        );
        let mut b = VMContextBuilder::new();
        b.current_account_id("token.test".parse().unwrap())
            .predecessor_account_id("token.test".parse().unwrap())
            .account_balance(NearToken::from_near(100));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(br#""20""#.to_vec())]
        );
        assert_eq!(t.ft_resolve_tracked(alice.clone(), U64(2)), U128(80));
        assert_eq!(t.ft_balance_of(alice.clone()), U128(920));
        assert_eq!(t.ft_resolve_tracked(alice.clone(), U64(2)), U128(80));
        assert_eq!(t.ft_balance_of(alice), U128(920));
        assert_eq!(t.ft_balance_of(bob), U128(80));
    }
}

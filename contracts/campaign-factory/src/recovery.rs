//! Resume only immutable intents. Atomic create-account batches cannot redeploy
//! an existing child. Native reserves protect every other unfinished campaign.
use super::*;
const DELAY: u64 = 300_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct CreationProgress {
    pub version: U64,
    pub updated_at: U64,
    pub children: [bool; 2],
    pub registered: [bool; 3],
}

#[near]
impl Factory {
    pub fn get_creation_progress(&self, id: String) -> Option<CreationProgress> {
        self.progress.get(&id)
    }

    #[payable]
    pub fn recover_campaign(&mut self, id: String, version: U64) -> Promise {
        assert_one_yocto();
        assert!(env::prepaid_gas() >= Gas::from_tgas(300), "attach 300 Tgas");
        let (c, mut p) = self.expected(&id, version);
        assert!(c.status != CreationStatus::Ready, "campaign already ready");
        assert!(
            env::block_timestamp().saturating_sub(p.updated_at.0) >= DELAY,
            "recovery cooldown: wait five minutes"
        );
        // A new generation invalidates late callbacks, never the immutable intent.
        self.save_progress(&id, &mut p);
        let query = |account: AccountId, method: &str, args: near_sdk::serde_json::Value| {
            Promise::new(account).function_call(
                method.to_string(),
                args.to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(5),
            )
        };
        let mut promise = query(
            c.vault_id.clone(),
            "get_config",
            near_sdk::serde_json::json!({}),
        )
        .and(query(
            c.strategy_id.clone(),
            "get_position",
            near_sdk::serde_json::json!({}),
        ));
        for account in [&c.vault_id, &c.strategy_id, &c.beneficiary_id] {
            promise = promise.and(query(
                self.token_id.clone(),
                "storage_balance_of",
                near_sdk::serde_json::json!({"account_id":account}),
            ));
        }
        promise.then(
            callbacks::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(220))
                .on_creation_probe(id, p.version),
        )
    }

    #[private]
    pub fn on_creation_probe(&mut self, id: String, version: U64) -> bool {
        let (mut c, mut p) = self.expected(&id, version);
        assert!(c.status != CreationStatus::Ready, "campaign already ready");
        assert_eq!(env::promise_results_count(), 5);
        let read = |i| {
            env::promise_result_checked(i, 4096).ok().and_then(|b| {
                near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(&b).ok()
            })
        };
        if let Some(v) = read(0) {
            let expected = self.vault_config(&c);
            // Exact fields from our pinned template, not just a responding account.
            if expected
                .as_object()
                .unwrap()
                .iter()
                .all(|(key, value)| &v[key] == value)
            {
                p.children[0] = true;
            }
        }
        if let Some(v) = read(1) {
            if v["mode"] == "funded_simulator"
                && v["token_id"] == c.token_id.as_str()
                && v["vault_id"] == c.vault_id.as_str()
                && v["controller_id"] == c.creator_id.as_str()
                && v["loss_sink_id"] == c.creator_id.as_str()
            {
                p.children[1] = true;
            }
        }
        for i in 0..3 {
            if read(i as u64 + 2).is_some_and(|v| {
                v["total"]
                    .as_str()
                    .and_then(|s| s.parse::<u128>().ok())
                    .is_some_and(|n| n >= self.token_storage)
            }) {
                p.registered[i] = true;
            }
        }
        self.save_progress(&id, &mut p);
        if p.children.iter().all(|v| *v) && p.registered.iter().all(|v| *v) {
            c.status = CreationStatus::Ready;
            self.campaigns.insert(&id, &c);
            return true;
        }
        // Refund receipts can arrive after failure callbacks. If liquidity is not
        // back yet, keep the proven progress and let a later attempt resume.
        if !self.is_liquid() {
            c.status = CreationStatus::Failed;
            self.campaigns.insert(&id, &c);
            return false;
        }
        if p.children.iter().all(|v| *v) {
            self.start_registration(&mut c, &p);
        } else {
            c.status = CreationStatus::Creating;
            self.campaigns.insert(&id, &c);
            self.deploy_missing(&c, &p).detach();
        }
        false
    }
}

impl Factory {
    pub(super) fn expected(&self, id: &String, version: U64) -> (Campaign, CreationProgress) {
        let c = self.campaigns.get(id).expect("unknown campaign");
        let p = self.progress.get(id).expect("missing creation progress");
        assert_eq!(p.version, version, "stale creation version");
        (c, p)
    }
    pub(super) fn remaining(&self, p: &CreationProgress) -> u128 {
        (if p.children[0] {
            0
        } else {
            self.account_funding(VAULT)
        }) + (if p.children[1] {
            0
        } else {
            self.account_funding(STRATEGY)
        }) + p.registered.iter().filter(|v| !**v).count() as u128 * self.token_storage
    }
    pub(super) fn save_progress(&mut self, id: &String, p: &mut CreationProgress) {
        let old = self.progress.get(id).expect("missing progress");
        // Proof only advances. It never recreates a released liability.
        for i in 0..2 {
            assert!(!old.children[i] || p.children[i]);
        }
        for i in 0..3 {
            assert!(!old.registered[i] || p.registered[i]);
        }
        self.reserved_native = self
            .reserved_native
            .checked_sub(self.remaining(&old) - self.remaining(p))
            .expect("reserve underflow");
        p.version.0 = p.version.0.checked_add(1).expect("version overflow");
        p.updated_at = U64(env::block_timestamp());
        self.progress.insert(id, p);
    }
    fn is_liquid(&self) -> bool {
        env::account_balance().as_yoctonear()
            >= u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear()
                + self.reserved_native
    }
    pub(super) fn assert_liquid(&self) {
        assert!(self.is_liquid(), "wait for pending native refunds");
    }
    fn vault_config(&self, c: &Campaign) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"campaign_id":c.id,"token_id":self.token_id,"token_decimals":self.token_decimals,
            "beneficiary_id":c.beneficiary_id,"guardian_id":c.creator_id,"deposit_cap":c.deposit_cap,
            "metadata_hash":c.metadata_hash,"disclosure_version":"factory-v2","strategy_id":c.strategy_id})
    }
    pub(super) fn deploy_missing(&self, c: &Campaign, p: &CreationProgress) -> Promise {
        let mut result: Option<Promise> = None;
        let mut mask = 0;
        for (i, account, code, args) in [
            (
                0,
                c.vault_id.clone(),
                VAULT,
                near_sdk::serde_json::json!({"config":self.vault_config(c)}),
            ),
            (
                1,
                c.strategy_id.clone(),
                STRATEGY,
                near_sdk::serde_json::json!({"token_id":self.token_id,"vault_id":c.vault_id,"controller_id":c.creator_id,"loss_sink_id":c.creator_id}),
            ),
        ] {
            if p.children[i] {
                continue;
            }
            mask |= 1 << i;
            let init_method = "new_from_factory";
            #[cfg(feature = "test-faults")]
            let init_method = if self.fault_stage == 4 && i == 1 {
                "injected_missing_method"
            } else {
                init_method
            };
            let promise = Promise::new(account)
                .create_account()
                .transfer(NearToken::from_yoctonear(self.account_funding(code)))
                .deploy_contract(code.to_vec())
                .function_call(
                    init_method,
                    args.to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(15),
                );
            result = Some(match result {
                Some(previous) => previous.and(promise),
                None => promise,
            });
        }
        result.expect("no missing children").then(
            callbacks::ext(env::current_account_id())
                .with_static_gas(Gas::from_tgas(110))
                .on_created(c.id.clone(), p.version, mask),
        )
    }
    pub(super) fn start_registration(&mut self, c: &mut Campaign, p: &CreationProgress) {
        // Even previously registered accounts are safe: NEP-145 refunds an
        // idempotent registration. Protect their extra temporary funding too.
        let extra = p.registered.iter().filter(|v| **v).count() as u128 * self.token_storage;
        let needed = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear()
            + self.reserved_native
            + extra;
        if env::account_balance().as_yoctonear() < needed {
            c.status = CreationStatus::Failed;
            self.campaigns.insert(&c.id, c);
            return;
        }
        c.status = CreationStatus::Registering;
        self.campaigns.insert(&c.id, c);
        self.registration(&c.vault_id)
            .and(self.registration(&c.strategy_id))
            .and(self.registration(&c.beneficiary_id))
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_registered(c.id.clone(), p.version),
            )
            .detach();
    }
}

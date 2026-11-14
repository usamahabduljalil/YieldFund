//! Permissionless creation from pinned templates; verification never grants custody.
use near_sdk::{
    assert_one_yocto,
    collections::{LookupMap, Vector},
    env, ext_contract,
    json_types::{U128, U64},
    near, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

const VAULT: &[u8] = include_bytes!("../../../artifacts/yieldfund_vault.wasm");
const STRATEGY: &[u8] = include_bytes!("../../../artifacts/yieldfund_strategy_simulator.wasm");
mod recovery;
use recovery::CreationProgress;
const RECORD_BYTES: u128 = 4096;
const ACCOUNT_BUFFER: u128 = 500_000_000_000_000_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CreationStatus {
    Creating,
    Registering,
    Ready,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Verification {
    pub verifier_id: AccountId,
    pub metadata_hash: String,
    pub evidence_hash: String,
    pub expires_at: U64,
    pub issued_at: U64,
    pub revoked: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Campaign {
    pub id: String,
    pub name: String,
    pub creator_id: AccountId,
    pub vault_id: AccountId,
    pub strategy_id: AccountId,
    pub beneficiary_id: AccountId,
    pub token_id: AccountId,
    pub metadata_hash: String,
    pub deposit_cap: U128,
    pub status: CreationStatus,
    pub verification: Option<Verification>,
    pub created_at: U64,
}

#[allow(dead_code)]
#[ext_contract(callbacks)]
trait Callbacks {
    fn on_created(&mut self, id: String, version: U64, mask: u8) -> bool;
    fn on_registered(&mut self, id: String, version: U64) -> bool;
    fn on_creation_probe(&mut self, id: String, version: U64) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    verifier_id: AccountId,
    token_id: AccountId,
    token_decimals: u8,
    token_storage: u128,
    campaigns: LookupMap<String, Campaign>,
    ids: Vector<String>,
    progress: LookupMap<String, CreationProgress>,
    reserved_native: u128,
    #[cfg(feature = "test-faults")]
    fault_stage: u8,
}

#[near]
impl Factory {
    #[init]
    pub fn new(
        verifier_id: AccountId,
        token_id: AccountId,
        token_decimals: u8,
        token_storage: U128,
    ) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "self initialization only"
        );
        assert!(
            token_decimals <= 24 && token_storage.0 > 0,
            "invalid token configuration"
        );
        Self {
            verifier_id,
            token_id,
            token_decimals,
            token_storage: token_storage.0,
            campaigns: LookupMap::new(b"c"),
            ids: Vector::new(b"i"),
            progress: LookupMap::new(b"p"),
            reserved_native: 0,
            #[cfg(feature = "test-faults")]
            fault_stage: 0,
        }
    }

    pub fn creation_cost(&self) -> U128 {
        U128(
            self.account_funding(VAULT)
                + self.account_funding(STRATEGY)
                + self.token_storage * 3
                + RECORD_BYTES * env::storage_byte_cost().as_yoctonear(),
        )
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"verifier_id":self.verifier_id,"token_id":self.token_id,
            "token_decimals":self.token_decimals,"strategy_mode":"funded_simulator",
            "vault_code_hash":hex(&env::sha256(VAULT)),"strategy_code_hash":hex(&env::sha256(STRATEGY)),
            "recovery_version":2,"creation_cost":self.creation_cost(),"campaign_count":U64(self.ids.len())})
    }

    /// Exact funding; no key is added to either child account.
    #[payable]
    pub fn create_campaign(
        &mut self,
        id: String,
        name: String,
        beneficiary_id: AccountId,
        metadata_hash: String,
        deposit_cap: U128,
    ) -> Promise {
        assert!(valid_id(&id), "invalid campaign id");
        assert!(!name.trim().is_empty() && name.len() <= 80, "invalid name");
        assert!(
            valid_hash(&metadata_hash) && deposit_cap.0 > 0,
            "invalid metadata or cap"
        );
        assert!(!self.campaigns.contains_key(&id), "campaign already exists");
        assert_eq!(
            env::attached_deposit().as_yoctonear(),
            self.creation_cost().0,
            "attach exact creation cost"
        );
        assert!(
            env::prepaid_gas() >= Gas::from_tgas(250),
            "attach 250 Tgas or more"
        );
        let parent = env::current_account_id();
        let vault_id: AccountId = format!("v-{id}.{parent}")
            .parse()
            .expect("vault account too long");
        let strategy_id: AccountId = format!("s-{id}.{parent}")
            .parse()
            .expect("strategy account too long");
        assert!(
            beneficiary_id != vault_id
                && beneficiary_id != strategy_id
                && beneficiary_id != self.token_id
                && beneficiary_id != parent,
            "invalid beneficiary"
        );
        let creator = env::predecessor_account_id();
        assert!(
            creator != vault_id && creator != strategy_id,
            "invalid creator"
        );
        let campaign = Campaign {
            id: id.clone(),
            name,
            creator_id: creator.clone(),
            vault_id: vault_id.clone(),
            strategy_id: strategy_id.clone(),
            beneficiary_id: beneficiary_id.clone(),
            token_id: self.token_id.clone(),
            metadata_hash: metadata_hash.clone(),
            deposit_cap,
            status: CreationStatus::Creating,
            verification: None,
            created_at: U64(env::block_timestamp()),
        };
        let before = env::storage_usage();
        self.ids.push(&id);
        self.campaigns.insert(&id, &campaign);
        let progress = CreationProgress {
            version: U64(1),
            updated_at: U64(env::block_timestamp()),
            children: [false; 2],
            registered: [false; 3],
        };
        self.progress.insert(&id, &progress);
        assert!(
            u128::from(env::storage_usage() - before) <= RECORD_BYTES,
            "record budget exceeded"
        );

        self.reserved_native = self
            .reserved_native
            .checked_add(self.remaining(&progress))
            .expect("reserve overflow");
        self.assert_liquid();
        self.deploy_missing(&campaign, &progress)
    }

    #[private]
    pub fn on_created(&mut self, id: String, version: U64, mask: u8) -> bool {
        #[cfg(feature = "test-faults")]
        assert_ne!(self.fault_stage, 1, "injected creation callback failure");
        let (mut c, mut p) = self.expected(&id, version);
        assert_eq!(c.status, CreationStatus::Creating, "stale callback");
        assert_eq!(env::promise_results_count(), mask.count_ones() as u64);
        let mut result = 0;
        for i in 0..2 {
            if mask & (1 << i) != 0 {
                if env::promise_result_checked(result, 4096).is_ok() {
                    p.children[i] = true;
                }
                result += 1;
            }
        }
        self.save_progress(&id, &mut p);
        if !p.children.iter().all(|v| *v) {
            c.status = CreationStatus::Failed;
            self.campaigns.insert(&id, &c);
            return false;
        }
        self.start_registration(&mut c, &p);
        true
    }

    #[private]
    pub fn on_registered(&mut self, id: String, version: U64) -> bool {
        #[cfg(feature = "test-faults")]
        assert_ne!(
            self.fault_stage, 2,
            "injected registration callback failure"
        );
        let (mut c, mut p) = self.expected(&id, version);
        assert_eq!(c.status, CreationStatus::Registering, "stale callback");
        assert_eq!(env::promise_results_count(), 3);
        for i in 0..3 {
            if env::promise_result_checked(i as u64, 4096).is_ok() {
                p.registered[i] = true;
            }
        }
        self.save_progress(&id, &mut p);
        let ready = p.registered.iter().all(|v| *v);
        c.status = if ready {
            CreationStatus::Ready
        } else {
            CreationStatus::Failed
        };
        self.campaigns.insert(&id, &c);
        ready
    }

    pub fn get_campaign(&self, id: String) -> Option<Campaign> {
        self.campaigns.get(&id)
    }
    #[cfg(feature = "test-faults")]
    pub fn test_set_creation_fault(&mut self, stage: u8) {
        assert_eq!(env::predecessor_account_id(), env::current_account_id());
        self.fault_stage = stage;
    }
    pub fn list_campaigns(&self, from_index: U64, limit: u32) -> Vec<Campaign> {
        assert!(limit > 0 && limit <= 50, "limit must be 1..50");
        (from_index.0
            ..self
                .ids
                .len()
                .min(from_index.0.saturating_add(u64::from(limit))))
            .filter_map(|i| self.ids.get(i).and_then(|id| self.campaigns.get(&id)))
            .collect()
    }
    pub fn is_verified(&self, id: String) -> bool {
        self.campaigns.get(&id).is_some_and(|c| {
            c.status == CreationStatus::Ready
                && c.verification.is_some_and(|v| {
                    !v.revoked
                        && v.metadata_hash == c.metadata_hash
                        && v.expires_at.0 > env::block_timestamp()
                })
        })
    }
    #[payable]
    pub fn verify_campaign(
        &mut self,
        id: String,
        metadata_hash: String,
        evidence_hash: String,
        expires_at: U64,
    ) {
        assert_one_yocto();
        assert_eq!(
            env::predecessor_account_id(),
            self.verifier_id,
            "verifier only"
        );
        let mut c = self.campaigns.get(&id).expect("unknown campaign");
        assert_eq!(c.status, CreationStatus::Ready, "campaign not ready");
        assert_eq!(metadata_hash, c.metadata_hash, "metadata changed");
        assert!(
            valid_hash(&evidence_hash) && expires_at.0 > env::block_timestamp(),
            "invalid attestation"
        );
        c.verification = Some(Verification {
            verifier_id: self.verifier_id.clone(),
            metadata_hash,
            evidence_hash,
            expires_at,
            issued_at: U64(env::block_timestamp()),
            revoked: false,
        });
        self.campaigns.insert(&id, &c);
    }
    #[payable]
    pub fn revoke_verification(&mut self, id: String) {
        assert_one_yocto();
        assert_eq!(
            env::predecessor_account_id(),
            self.verifier_id,
            "verifier only"
        );
        let mut c = self.campaigns.get(&id).expect("unknown campaign");
        if let Some(ref mut v) = c.verification {
            v.revoked = true;
        }
        self.campaigns.insert(&id, &c);
    }
}
impl Factory {
    fn account_funding(&self, code: &[u8]) -> u128 {
        (code.len() as u128 + 4096) * env::storage_byte_cost().as_yoctonear() + ACCOUNT_BUFFER
    }
    fn registration(&self, account_id: &AccountId) -> Promise {
        let method = "storage_deposit";
        #[cfg(feature = "test-faults")]
        let method = if self.fault_stage == 8 && account_id.as_str().starts_with("s-") {
            "injected_missing_method"
        } else {
            method
        };
        Promise::new(self.token_id.clone()).function_call(
            method,
            near_sdk::serde_json::json!({"account_id":account_id,"registration_only":true})
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(self.token_storage),
            Gas::from_tgas(15),
        )
    }
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 24
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !s.starts_with('-')
        && !s.ends_with('-')
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests;

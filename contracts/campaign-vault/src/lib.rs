//! Single-strategy vault with funded simulator adapter and fixed DAO settlement.
//! Every amount is in the configured token's base units. See contracts/README.md.
use near_sdk::{
    assert_one_yocto,
    collections::LookupMap,
    env, ext_contract,
    json_types::{U128, U64},
    near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use yieldfund_accounting::Snapshot;
#[path = "strategy.rs"]
mod lifecycle;
mod recovery;

const POSITION_BYTES: u128 = 512;
const OPERATION_BYTES: u128 = 2048;
const BALANCE_GAS: Gas = Gas::from_tgas(10);
const RECONCILE_GAS: Gas = Gas::from_tgas(75);
const TRANSFER_GAS: Gas = Gas::from_tgas(20);
const FINALIZE_GAS: Gas = Gas::from_tgas(20);
const START_GAS: u64 = 110;
const RECOVERY_DELAY_NS: u64 = 300_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub campaign_id: String,
    pub token_id: AccountId,
    pub token_decimals: u8,
    pub beneficiary_id: AccountId,
    pub guardian_id: AccountId,
    pub deposit_cap: U128,
    pub metadata_hash: String,
    pub disclosure_version: String,
    /// None retains the idle-only deployment path. Immutable after initialization.
    #[serde(default)]
    pub strategy_id: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Position {
    pub nominal: U128,
    pub reserved: U128,
    pub deposited: U128,
    pub withdrawn: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Requested,
    Reconciling,
    TransferPending,
    Completed,
    Cancelled,
    RetryableFailure,
    NeedsReconciliation,
    Allocating,
    Redeeming,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Withdrawal,
    Checkpoint,
    Allocation,
    Redemption,
    Donation,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Operation {
    pub id: U64,
    pub kind: Kind,
    pub owner_id: AccountId,
    pub units: U128,
    pub minimum: U128,
    pub payout: U128,
    pub stage: Stage,
    pub version: U64,
    pub started_at: U64,
    pub updated_at: U64,
    pub error: Option<String>,
}

#[near(serializers = [json])]
pub struct AccountingView {
    pub mode: String,
    pub cash: U128,
    pub excluded: U128,
    pub nominal: U128,
    pub backing: U128,
    pub shortfall: U128,
    pub eligible_yield: U128,
    pub reserved_outbound: U128,
    pub paused: bool,
    pub active_operation: Option<U64>,
    pub state_version: U64,
    pub checkpoint_at: U64,
    pub needs_reconciliation: bool,
    pub strategy_book: U128,
    pub settled: bool,
    pub donated: U128,
    pub queued_redemption: Option<U64>,
}

#[near(serializers = [json])]
struct RedemptionResult {
    complete: bool,
    amount: U128,
}

#[allow(dead_code)]
#[ext_contract(ft)]
trait Token {
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
}
#[allow(dead_code)]
#[ext_contract(strategy)]
trait Strategy {
    fn redeem_all(&mut self, operation_id: U64) -> RedemptionResult;
    fn get_position(&self) -> recovery::StrategyEvidence;
}
#[allow(dead_code)]
#[ext_contract(callbacks)]
trait Callbacks {
    fn on_balance(&mut self, operation_id: U64, version: U64) -> PromiseOrValue<bool>;
    fn on_transfer(&mut self, operation_id: U64, version: U64) -> bool;
    fn on_allocation(&mut self, operation_id: U64, version: U64) -> bool;
    fn on_redemption(&mut self, operation_id: U64, version: U64) -> bool;
    fn on_donation(&mut self, operation_id: U64, version: U64) -> bool;
    fn on_recovery_redemption(&mut self, operation_id: U64, version: U64) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    config: Config,
    positions: LookupMap<AccountId, Position>,
    operations: LookupMap<u64, Operation>,
    cash: u128,
    excluded: u128,
    nominal: u128,
    next_id: u64,
    version: u64,
    active: Option<u64>,
    paused: bool,
    checkpoint_at: u64,
    strategy_book: u128,
    eligible: u128,
    donated: u128,
    pending_redemption: Option<u64>,
    #[cfg(feature = "test-faults")]
    fail_callback: bool,
    #[cfg(feature = "test-faults")]
    fail_balance_callback: bool,
    #[cfg(feature = "test-faults")]
    fail_redemption_callback: bool,
}

#[near]
impl Vault {
    #[init]
    pub fn new(config: Config) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "initialize from vault account"
        );
        Self::initialize(config)
    }

    /// Factory-created accounts have no keys. Only their direct parent may initialize.
    #[init]
    pub fn new_from_factory(config: Config) -> Self {
        let current = env::current_account_id();
        let (_, parent) = current
            .as_str()
            .split_once('.')
            .expect("subaccount required");
        assert_eq!(
            env::predecessor_account_id().as_str(),
            parent,
            "parent factory only"
        );
        Self::initialize(config)
    }
}

#[near]
impl Vault {
    fn initialize(config: Config) -> Self {
        assert!(
            !config.campaign_id.is_empty() && config.campaign_id.len() <= 64,
            "invalid campaign id"
        );
        assert!(config.metadata_hash.len() <= 128, "metadata too large");
        assert!(
            !config.disclosure_version.is_empty() && config.disclosure_version.len() <= 32,
            "invalid disclosure version"
        );
        assert!(
            config.deposit_cap.0 > 0 && config.token_decimals <= 24,
            "invalid token bounds"
        );
        assert_ne!(
            config.token_id,
            env::current_account_id(),
            "vault cannot be token"
        );
        assert_ne!(
            config.beneficiary_id,
            env::current_account_id(),
            "vault cannot be beneficiary"
        );
        if let Some(id) = &config.strategy_id {
            assert_ne!(id, &env::current_account_id(), "invalid strategy");
            assert_ne!(id, &config.token_id, "invalid strategy");
            assert_ne!(id, &config.beneficiary_id, "invalid strategy");
        }
        let vault = Self {
            config,
            positions: LookupMap::new(b"p"),
            operations: LookupMap::new(b"o"),
            cash: 0,
            excluded: 0,
            nominal: 0,
            next_id: 1,
            version: 0,
            active: None,
            paused: false,
            checkpoint_at: env::block_timestamp(),
            strategy_book: 0,
            eligible: 0,
            donated: 0,
            pending_redemption: None,
            #[cfg(feature = "test-faults")]
            fail_callback: false,
            #[cfg(feature = "test-faults")]
            fail_balance_callback: false,
            #[cfg(feature = "test-faults")]
            fail_redemption_callback: false,
        };
        vault.emit("campaign_initialized", None, None, 0);
        vault
    }

    /// Paid, permanent position registration. No arbitrary metadata is stored per user.
    /// This vault is not a fungible token and does not advertise full NEP-145 support.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> bool {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        if self.positions.contains_key(&account) {
            Self::refund(env::attached_deposit().as_yoctonear());
            return false;
        }
        Self::charge(Self::storage_cost(POSITION_BYTES));
        let before = env::storage_usage();
        self.positions.insert(&account, &Position::default());
        assert!(
            u128::from(env::storage_usage() - before) <= POSITION_BYTES,
            "registration storage budget exceeded"
        );
        true
    }

    pub fn storage_costs(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "position": Self::storage_cost(POSITION_BYTES).to_string(),
            "operation": (Self::storage_cost(OPERATION_BYTES) + 1).to_string(),
            "advance": "1", "refundable": false
        })
    }

    /// The exact predecessor is authenticated before sender_id is trusted.
    /// Rejections return all tokens to the standard resolver; never manually refund.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        assert_eq!(
            env::predecessor_account_id(),
            self.config.token_id,
            "unsupported token"
        );
        if let Some(id) = msg
            .strip_prefix("strategy_return:")
            .and_then(|s| s.parse::<u64>().ok())
        {
            if self.config.strategy_id.as_ref() != Some(&sender_id)
                || self.active != Some(id)
                || amount.0 == 0
            {
                return amount;
            }
            let mut op = self.operation(id);
            if op.kind != Kind::Redemption || op.stage != Stage::Redeeming || op.payout.0 != 0 {
                return amount;
            }
            self.cash = self.cash.checked_add(amount.0).expect("cash overflow");
            op.payout = amount;
            // Preserve callback version: this authenticated hook belongs to the same stage.
            self.operations.insert(&id, &op);
            self.emit(
                "strategy_return_received",
                Some(op.id),
                Some(&sender_id),
                amount.0,
            );
            return U128(0);
        }
        let reject = |reason: &str| {
            env::log_str(&format!("deposit rejected: {reason}"));
            amount
        };
        if msg != "deposit" || amount.0 == 0 {
            return reject("invalid deposit");
        }
        if self.paused || self.active.is_some() {
            return reject("deposits locked");
        }
        let Some(mut p) = self.positions.get(&sender_id) else {
            return reject("register position storage first");
        };
        let Ok(next) = self.snapshot().accept_deposit(amount.0) else {
            return reject("unhealthy or overflow");
        };
        if next.nominal > self.config.deposit_cap.0 {
            return reject("cap exceeded");
        }
        let Some(units) = p.nominal.0.checked_add(amount.0) else {
            return reject("position overflow");
        };
        let Some(deposited) = p.deposited.0.checked_add(amount.0) else {
            return reject("history overflow");
        };
        p.nominal = U128(units);
        p.deposited = U128(deposited);
        self.cash = next.cash;
        self.nominal = next.nominal;
        self.positions.insert(&sender_id, &p);
        self.bump();
        self.emit("deposit_accepted", None, Some(&sender_id), amount.0);
        U128(0)
    }

    #[payable]
    pub fn request_withdraw(&mut self, units: U128, min_amount: U128) -> U64 {
        self.require_idle();
        let owner = env::predecessor_account_id();
        let mut p = self.positions.get(&owner).expect("unregistered position");
        assert!(
            units.0 > 0 && units.0 <= p.nominal.0 - p.reserved.0,
            "insufficient available units"
        );
        assert!(min_amount.0 <= units.0, "minimum exceeds nominal claim");
        Self::charge(Self::storage_cost(OPERATION_BYTES) + 1);
        p.reserved.0 += units.0;
        self.positions.insert(&owner, &p);
        let op = self.new_operation(Kind::Withdrawal, owner.clone(), units, min_amount);
        self.emit("withdrawal_requested", Some(op.id), Some(&owner), units.0);
        op.id
    }

    #[payable]
    pub fn cancel_withdraw(&mut self, operation_id: U64) {
        assert_one_yocto();
        let mut op = self.operation(operation_id.0);
        assert_eq!(op.owner_id, env::predecessor_account_id(), "owner only");
        assert_eq!(op.kind, Kind::Withdrawal, "not a withdrawal");
        assert!(
            matches!(op.stage, Stage::Requested | Stage::RetryableFailure),
            "cannot cancel processing request"
        );
        let mut p = self.positions.get(&op.owner_id).expect("position missing");
        p.reserved.0 = p
            .reserved
            .0
            .checked_sub(op.units.0)
            .expect("reserved underflow");
        self.positions.insert(&op.owner_id, &p);
        op.stage = Stage::Cancelled;
        self.save_operation(&mut op);
        self.emit(
            "withdrawal_cancelled",
            Some(op.id),
            Some(&op.owner_id),
            op.units.0,
        );
    }

    /// A bounded, permissionless advance. The immutable request owner is the only recipient.
    #[payable]
    pub fn advance_operation(&mut self, operation_id: U64) -> Promise {
        assert_one_yocto();
        self.require_idle();
        Self::require_gas();
        let mut op = self.operation(operation_id.0);
        assert!(
            matches!(op.stage, Stage::Requested | Stage::RetryableFailure),
            "operation not retryable"
        );
        assert!(
            matches!(
                op.kind,
                Kind::Withdrawal | Kind::Checkpoint | Kind::Donation | Kind::Redemption
            ),
            "operation cannot be replayed"
        );
        if op.kind == Kind::Redemption {
            return self.start_redemption(&mut op);
        }
        assert_eq!(self.strategy_book, 0, "redeem strategy fully first");
        self.start_reconcile(&mut op)
    }

    /// Only inspects the fixed token. It cannot supply a valuation or sweep excess tokens.
    #[payable]
    pub fn request_checkpoint(&mut self) -> Promise {
        self.require_guardian();
        self.require_idle();
        assert_eq!(self.strategy_book, 0, "redeem strategy fully first");
        Self::require_gas();
        Self::charge(Self::storage_cost(OPERATION_BYTES) + 1);
        let mut op = self.new_operation(
            Kind::Checkpoint,
            env::predecessor_account_id(),
            U128(0),
            U128(0),
        );
        self.start_reconcile(&mut op)
    }

    #[private]
    pub fn on_balance(&mut self, operation_id: U64, version: U64) -> PromiseOrValue<bool> {
        let mut op = self.expected(operation_id, version, Stage::Reconciling);
        #[cfg(feature = "test-faults")]
        assert!(
            !self.fail_balance_callback,
            "injected balance callback interruption"
        );
        let actual = if env::promise_results_count() == 1 {
            match env::promise_result_checked(0, 64) {
                Ok(bytes) => near_sdk::serde_json::from_slice::<U128>(&bytes).ok(),
                Err(_) => None,
            }
        } else {
            None
        };
        let Some(actual) = actual else {
            // No money was sent by a balance query: retrying only that read is safe.
            op.stage = Stage::RetryableFailure;
            op.error = Some("balance_read_failed".into());
            self.active = None;
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        };
        if actual.0 < self.cash {
            // The strategy is fully redeemed here. An unexplained custody shortfall
            // is not caller-authorized loss recognition; preserve the ledger and stop.
            op.stage = Stage::NeedsReconciliation;
            op.error = Some("unexplained_cash_shortfall".into());
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        }
        // Excess is NEVER yield. Recompute it, allowing transient rejected-deposit
        // refunds to leave without incorrectly reducing recognized supporter cash.
        self.excluded = actual.0 - self.cash;
        self.checkpoint_at = env::block_timestamp();
        if op.kind == Kind::Checkpoint {
            op.stage = Stage::Completed;
            self.active = None;
            self.save_operation(&mut op);
            self.emit("checkpoint_completed", Some(op.id), None, self.cash);
            return PromiseOrValue::Value(true);
        }
        if op.kind == Kind::Donation {
            return self.settle_donation(op);
        }
        let mut snapshot = self.snapshot();
        snapshot.pending = false; // Only this authenticated reconciliation may settle.
        let Ok((reserved, payout)) = snapshot.reserve_redemption(op.units.0, op.minimum.0) else {
            op.stage = Stage::Requested;
            op.error = Some("minimum_not_met".into());
            self.active = None;
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        };
        let mut p = self.positions.get(&op.owner_id).expect("position missing");
        p.nominal.0 = p
            .nominal
            .0
            .checked_sub(op.units.0)
            .expect("units underflow");
        // Reserved units remain attached to the operation until success or rollback.
        p.reserved.0 = p
            .reserved
            .0
            .checked_sub(op.units.0)
            .expect("reservation underflow");
        p.withdrawn.0.checked_add(payout).expect("history overflow");
        self.positions.insert(&op.owner_id, &p);
        self.cash = reserved.cash;
        self.nominal = reserved.nominal;
        op.payout = U128(payout);
        op.stage = Stage::TransferPending;
        op.error = None;
        self.save_operation(&mut op);
        self.emit(
            "withdrawal_transfer_started",
            Some(op.id),
            Some(&op.owner_id),
            payout,
        );
        if payout == 0 {
            op.stage = Stage::Completed;
            self.active = None;
            self.save_operation(&mut op);
            self.emit("withdrawal_completed", Some(op.id), Some(&op.owner_id), 0);
            return PromiseOrValue::Value(true);
        }
        PromiseOrValue::Promise(
            ft::ext(self.config.token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(TRANSFER_GAS)
                .ft_transfer(
                    op.owner_id.clone(),
                    U128(payout),
                    Some(format!("yieldfund:{}", op.id.0)),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(FINALIZE_GAS)
                        .on_transfer(op.id, op.version),
                ),
        )
    }

    #[private]
    pub fn on_transfer(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::TransferPending);
        assert_eq!(op.kind, Kind::Withdrawal, "wrong callback kind");
        #[cfg(feature = "test-faults")]
        assert!(!self.fail_callback, "injected callback interruption");
        assert_eq!(env::promise_results_count(), 1, "ambiguous transfer result");
        let mut p = self.positions.get(&op.owner_id).expect("position missing");
        let success = match env::promise_result_checked(0, 64) {
            Ok(_) => {
                // The pinned standard token's ft_transfer is atomic, not transfer_call.
                p.withdrawn.0 = p
                    .withdrawn
                    .0
                    .checked_add(op.payout.0)
                    .expect("history overflow");
                op.stage = Stage::Completed;
                true
            }
            Err(PromiseError::Failed) => {
                self.cash = self.cash.checked_add(op.payout.0).expect("cash overflow");
                self.nominal = self
                    .nominal
                    .checked_add(op.units.0)
                    .expect("units overflow");
                p.nominal.0 = p
                    .nominal
                    .0
                    .checked_add(op.units.0)
                    .expect("position overflow");
                p.reserved.0 = p
                    .reserved
                    .0
                    .checked_add(op.units.0)
                    .expect("reservation overflow");
                op.stage = Stage::RetryableFailure;
                op.error = Some("token_transfer_failed".into());
                false
            }
            Err(_) => {
                // An oversized successful response is not evidence of transfer failure.
                // Keep the original pending reservation and lock; never restore/replay it.
                op.error = Some("unexpected_transfer_response".into());
                self.save_operation(&mut op);
                return false;
            }
        };
        self.positions.insert(&op.owner_id, &p);
        self.active = None;
        self.save_operation(&mut op);
        self.emit(
            if success {
                "withdrawal_completed"
            } else {
                "withdrawal_restored"
            },
            Some(op.id),
            Some(&op.owner_id),
            op.payout.0,
        );
        success
    }

    #[payable]
    pub fn set_paused(&mut self, paused: bool) {
        assert_one_yocto();
        self.require_guardian();
        self.paused = paused;
        self.bump();
        self.emit(
            if paused {
                "new_risk_paused"
            } else {
                "new_risk_resumed"
            },
            None,
            None,
            0,
        );
    }

    // Compiled only into a separate local fault-test artifact, never the normal Wasm.
    #[cfg(feature = "test-faults")]
    pub fn test_interrupt_callback(&mut self) {
        self.require_guardian();
        self.fail_callback = true;
    }

    #[cfg(feature = "test-faults")]
    pub fn test_set_read_fault(&mut self, stage: String, enabled: bool) {
        self.require_guardian();
        match stage.as_str() {
            "balance" => self.fail_balance_callback = enabled,
            "redemption" => self.fail_redemption_callback = enabled,
            _ => env::panic_str("unsupported test fault"),
        }
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }
    pub fn get_position(&self, account_id: AccountId) -> Option<Position> {
        self.positions.get(&account_id)
    }
    pub fn get_operation(&self, operation_id: U64) -> Option<Operation> {
        self.operations.get(&operation_id.0)
    }
    pub fn get_operations(&self, from_id: U64, limit: u32) -> Vec<Operation> {
        assert!(limit > 0 && limit <= 50, "limit must be 1..50");
        (from_id.0.max(1)..self.next_id)
            .take(limit as usize)
            .filter_map(|id| self.operations.get(&id))
            .collect()
    }
    pub fn get_accounting(&self) -> AccountingView {
        let op = self.active.map(|id| self.operation(id));
        let pending_transfer = op
            .as_ref()
            .is_some_and(|o| o.stage == Stage::TransferPending);
        AccountingView {
            mode: if self.config.strategy_id.is_some() {
                "funded_simulator"
            } else {
                "idle_only"
            }
            .into(),
            cash: U128(self.cash),
            excluded: U128(self.excluded),
            nominal: U128(self.nominal),
            backing: U128(
                self.cash
                    .saturating_add(self.strategy_book)
                    .min(self.nominal),
            ),
            shortfall: U128(
                self.nominal
                    .saturating_sub(self.cash.saturating_add(self.strategy_book)),
            ),
            eligible_yield: U128(if self.active.is_none() && self.strategy_book == 0 {
                self.eligible.min(self.cash.saturating_sub(self.nominal))
            } else {
                0
            }),
            strategy_book: U128(self.strategy_book),
            settled: self.active.is_none() && self.strategy_book == 0,
            donated: U128(self.donated),
            queued_redemption: self.pending_redemption.map(U64),
            reserved_outbound: U128(if pending_transfer {
                op.as_ref().unwrap().payout.0
            } else {
                0
            }),
            paused: self.paused,
            active_operation: self.active.map(U64),
            state_version: U64(self.version),
            checkpoint_at: U64(self.checkpoint_at),
            needs_reconciliation: op.as_ref().is_some_and(|o| {
                o.stage == Stage::NeedsReconciliation
                    || (o.stage == Stage::TransferPending && o.error.is_some())
                    || env::block_timestamp().saturating_sub(o.updated_at.0) > 300_000_000_000
            }),
        }
    }
}

impl Vault {
    fn snapshot(&self) -> Snapshot {
        // Internal cash is already net of quarantined extras and outgoing reservations.
        Snapshot {
            cash: self.cash,
            nominal: self.nominal,
            strategy: self.strategy_book,
            in_transit: 0,
            excluded: 0,
            pending: self.active.is_some(),
        }
    }
    fn require_idle(&self) {
        assert!(
            self.active.is_none(),
            "operation in progress; reconcile before retrying"
        );
    }
    fn require_guardian(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.config.guardian_id,
            "guardian only"
        );
    }
    fn require_gas() {
        assert!(
            env::prepaid_gas().as_tgas() >= START_GAS,
            "attach at least 110 Tgas"
        );
    }
    fn bump(&mut self) {
        self.version = self.version.checked_add(1).expect("version overflow");
    }
    fn operation(&self, id: u64) -> Operation {
        self.operations.get(&id).expect("operation not found")
    }
    fn expected(&self, id: U64, version: U64, stage: Stage) -> Operation {
        assert_eq!(self.active, Some(id.0), "inactive operation");
        let op = self.operation(id.0);
        assert_eq!(op.version, version, "stale operation version");
        assert_eq!(op.stage, stage, "unexpected operation stage");
        op
    }
    fn save_operation(&mut self, op: &mut Operation) {
        self.bump();
        op.version = U64(self.version);
        op.updated_at = U64(env::block_timestamp());
        self.operations.insert(&op.id.0, op);
    }
    fn new_operation(
        &mut self,
        kind: Kind,
        owner_id: AccountId,
        units: U128,
        minimum: U128,
    ) -> Operation {
        let id = self.next_id;
        self.next_id = self
            .next_id
            .checked_add(1)
            .expect("operation counter overflow");
        let mut op = Operation {
            id: U64(id),
            kind,
            owner_id,
            units,
            minimum,
            payout: U128(0),
            stage: Stage::Requested,
            version: U64(0),
            started_at: U64(env::block_timestamp()),
            updated_at: U64(env::block_timestamp()),
            error: None,
        };
        let before = env::storage_usage();
        self.save_operation(&mut op);
        // Leave headroom for subsequent fixed-size stage/error fields (max 64 bytes).
        assert!(
            u128::from(env::storage_usage() - before) + 128 <= OPERATION_BYTES,
            "operation storage budget exceeded"
        );
        op
    }
    fn start_reconcile(&mut self, op: &mut Operation) -> Promise {
        self.active = Some(op.id.0);
        op.stage = Stage::Reconciling;
        op.payout = U128(0); // Any earlier confirmed failure was already restored.
        op.error = None;
        self.save_operation(op);
        ft::ext(self.config.token_id.clone())
            .with_static_gas(BALANCE_GAS)
            .ft_balance_of(env::current_account_id())
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(RECONCILE_GAS)
                    .on_balance(op.id, op.version),
            )
    }
    fn storage_cost(bytes: u128) -> u128 {
        bytes
            .checked_mul(env::storage_byte_cost().as_yoctonear())
            .expect("storage overflow")
    }
    fn charge(required: u128) {
        let paid = env::attached_deposit().as_yoctonear();
        assert!(paid >= required, "insufficient storage deposit");
        Self::refund(paid - required);
    }
    fn refund(amount: u128) {
        if amount > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(amount))
                .detach();
        }
    }
    fn emit(
        &self,
        event: &str,
        operation_id: Option<U64>,
        account_id: Option<&AccountId>,
        amount: u128,
    ) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({
                "standard": "yieldfund", "version": "1.0.0", "event": event,
                "data": [{"campaign_id": self.config.campaign_id, "token_id": self.config.token_id,
                    "operation_id": operation_id, "account_id": account_id, "amount": amount.to_string(),
                    "state_version": self.version.to_string()}]
            })
        ));
    }
}

#[cfg(test)]
mod tests;

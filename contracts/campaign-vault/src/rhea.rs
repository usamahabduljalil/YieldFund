//! Direct supply-only integration with ref-finance/burrowland 2110c704.
//! simple_withdraw returns the token-transfer finalizer promise. execute(Withdraw)
//! does not, so it must never be substituted here. Unknown outcomes stay locked.
use super::*;
use std::collections::BTreeMap;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Phase {
    Idle,
    Reading,
    Ready,
    Withdrawing,
    Unknown,
}

#[near(serializers = [json])]
pub struct Asset {
    pub token_id: AccountId,
    pub balance: U128,
    pub shares: U128,
}
#[near(serializers = [json])]
pub struct LendingPosition {
    pub collateral: Vec<Asset>,
    pub borrowed: Vec<Asset>,
}
#[near(serializers = [json])]
pub struct LendingAccount {
    pub account_id: AccountId,
    pub supplied: Vec<Asset>,
    pub positions: BTreeMap<String, LendingPosition>,
    pub is_locked: bool,
}
#[near(serializers = [json])]
pub struct AssetConfig {
    pub extra_decimals: u8,
    pub can_withdraw: bool,
}
#[near(serializers = [json])]
pub struct ProtocolAsset {
    pub token_id: AccountId,
    pub config: AssetConfig,
}

#[allow(dead_code)]
#[ext_contract(lending)]
trait Lending {
    fn get_asset(&self, token_id: AccountId) -> Option<ProtocolAsset>;
    fn get_account_all_positions(&self, account_id: AccountId) -> Option<LendingAccount>;
    fn simple_withdraw(
        &mut self,
        token_id: AccountId,
        amount_with_inner_decimal: U128,
        recipient_id: Option<AccountId>,
    ) -> bool;
}
#[allow(dead_code)]
#[ext_contract(rhea_callbacks)]
trait RheaCallbacks {
    fn on_rhea_account(&mut self, operation_id: U64, version: U64) -> PromiseOrValue<bool>;
    fn on_rhea_withdraw(&mut self, operation_id: U64, version: U64) -> bool;
}

#[near]
impl Vault {
    /// Only advances a read or a definitively completed transfer. Never replays an
    /// unknown withdrawal, even after a timeout or an operator request.
    #[payable]
    pub fn continue_rhea_redemption(&mut self, operation_id: U64, version: U64) -> Promise {
        assert_one_yocto();
        let mut op = self.expected(operation_id, version, Stage::Redeeming);
        assert_eq!(self.pending_redemption, Some(op.id.0), "wrong redemption");
        assert!(
            matches!(self.rhea_phase, Phase::Ready | Phase::Reading),
            "withdrawal outcome unresolved"
        );
        self.read_rhea_account(&mut op)
    }

    /// Only a balance read is automatically recoverable for standard tokens.
    #[payable]
    pub fn recover_operation(&mut self, operation_id: U64, version: U64) -> Promise {
        assert_one_yocto();
        Self::require_gas();
        let mut op = self.expected(operation_id, version, Stage::Reconciling);
        assert!(matches!(
            op.kind,
            Kind::Checkpoint | Kind::Withdrawal | Kind::Donation
        ));
        assert_eq!(op.payout.0, 0, "payment outcome unresolved");
        assert_eq!(self.strategy_book, 0, "strategy unsettled");
        self.start_reconcile(&mut op)
    }

    #[private]
    pub fn on_rhea_account(&mut self, operation_id: U64, version: U64) -> PromiseOrValue<bool> {
        let mut op = self.expected(operation_id, version, Stage::Redeeming);
        assert_eq!(self.rhea_phase, Phase::Reading, "wrong Rhea phase");
        let read = |index, limit| {
            if env::promise_results_count() == 2 {
                env::promise_result_checked(index, limit).ok()
            } else {
                None
            }
        };
        let precision_valid = read(1, 32_768)
            .and_then(|b| near_sdk::serde_json::from_slice::<Option<ProtocolAsset>>(&b).ok())
            .flatten()
            .is_some_and(|a| {
                a.token_id == self.config.token_id
                    && a.config.can_withdraw
                    && a.config.extra_decimals == self.config.rhea_extra_decimals
            });
        let evidence = read(0, 16_384)
            .and_then(|b| near_sdk::serde_json::from_slice::<Option<LendingAccount>>(&b).ok())
            .flatten();
        let Some(account) = evidence.filter(|a| {
            a.account_id == env::current_account_id()
                && precision_valid
                && !a.is_locked
                && a.positions
                    .values()
                    .all(|p| p.collateral.is_empty() && p.borrowed.is_empty())
                && a.supplied
                    .iter()
                    .all(|a| a.token_id == self.config.token_id)
                && a.supplied.len() <= 1
        }) else {
            // Read failure has no outgoing effect. A fresh read may supersede it.
            self.rhea_phase = Phase::Ready;
            op.error = Some("rhea_account_evidence_unavailable".into());
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        };
        let supplied = account.supplied.first();
        if supplied.is_none() || supplied.is_some_and(|a| a.shares.0 == 0 && a.balance.0 == 0) {
            self.rhea_phase = Phase::Idle;
            return PromiseOrValue::Value(self.finish_redemption(op));
        }
        let asset = supplied.unwrap();
        let raw = asset.balance.0 / 10u128.pow(u32::from(self.config.rhea_extra_decimals));
        if raw == 0 {
            self.rhea_phase = Phase::Ready;
            op.error = Some("rhea_sub_token_dust_remaining".into());
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        }
        self.rhea_pending_amount = raw;
        self.rhea_phase = Phase::Withdrawing;
        op.error = None;
        self.save_operation(&mut op);
        PromiseOrValue::Promise(
            lending::ext(self.config.strategy_id.clone().unwrap())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(Gas::from_tgas(160))
                .simple_withdraw(
                    self.config.token_id.clone(),
                    asset.balance,
                    Some(env::current_account_id()),
                )
                .then(
                    rhea_callbacks::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(30))
                        .on_rhea_withdraw(op.id, op.version),
                ),
        )
    }

    #[private]
    pub fn on_rhea_withdraw(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::Redeeming);
        assert_eq!(self.rhea_phase, Phase::Withdrawing, "wrong Rhea phase");
        match Self::result::<bool>(8) {
            Some(true) => {
                // Credit exactly the amount requested in the authenticated promise,
                // never the observed balance delta (which may include gifts).
                self.cash = self
                    .cash
                    .checked_add(self.rhea_pending_amount)
                    .expect("cash overflow");
                op.payout.0 = op
                    .payout
                    .0
                    .checked_add(self.rhea_pending_amount)
                    .expect("return overflow");
                self.emit(
                    "rhea_return_received",
                    Some(op.id),
                    None,
                    self.rhea_pending_amount,
                );
                self.rhea_pending_amount = 0;
                self.rhea_phase = Phase::Ready;
                op.error = Some("rhea_position_check_required".into());
            }
            Some(false) => {
                // Pinned finalizer restored supply after a rejected token transfer.
                self.rhea_pending_amount = 0;
                self.rhea_phase = Phase::Ready;
                op.error = Some("rhea_transfer_failed".into());
            }
            None => {
                // Outer failure can include a failed protocol finalizer after payment.
                self.rhea_phase = Phase::Unknown;
                op.error = Some("rhea_withdrawal_outcome_unknown".into());
            }
        }
        self.save_operation(&mut op);
        false // More interest may have accrued. No settlement until position is empty.
    }

    pub fn get_rhea_status(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({ "phase": self.rhea_phase,
            "pending_raw_amount": self.rhea_pending_amount.to_string(),
            "position_owner": env::current_account_id(),
            "protocol_id": self.config.strategy_id,
            "extra_decimals": self.config.rhea_extra_decimals })
    }
}

impl Vault {
    pub(super) fn start_redemption(&mut self, op: &mut Operation) -> Promise {
        assert_eq!(self.pending_redemption, Some(op.id.0), "stale redemption");
        assert_eq!(
            self.rhea_phase,
            Phase::Idle,
            "Rhea operation already started"
        );
        self.active = Some(op.id.0);
        op.stage = Stage::Redeeming;
        self.read_rhea_account(op)
    }
    fn read_rhea_account(&mut self, op: &mut Operation) -> Promise {
        assert!(env::prepaid_gas().as_tgas() >= 260, "attach 260 Tgas");
        self.rhea_phase = Phase::Reading;
        self.save_operation(op);
        lending::ext(self.config.strategy_id.clone().unwrap())
            .with_static_gas(Gas::from_tgas(15))
            .get_account_all_positions(env::current_account_id())
            .and(
                lending::ext(self.config.strategy_id.clone().unwrap())
                    .with_static_gas(Gas::from_tgas(15))
                    .get_asset(self.config.token_id.clone()),
            )
            .then(
                rhea_callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(210))
                    .on_rhea_account(op.id, op.version),
            )
    }
}

#[cfg(test)]
mod tests;

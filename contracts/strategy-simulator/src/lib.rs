//! Single-vault, funded test strategy. This is not a lending protocol.
//! Only the separate simulation-controls artifact exposes loss/delay/partial controls.
#[cfg(test)]
mod tests;
use near_sdk::{
    assert_one_yocto, env, ext_contract,
    json_types::{U128, U64},
    near, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue,
};
#[cfg(feature = "simulation-controls")]
use near_sdk::{Promise, PromiseError};

#[near(serializers = [json])]
pub struct Redemption {
    pub complete: bool,
    pub amount: U128,
}

#[near(serializers = [json])]
pub struct CallReceipt {
    pub sender_id: AccountId,
    pub receiver_id: AccountId,
    pub sequence: U64,
    pub amount: U128,
    pub msg: String,
    pub used: Option<U128>,
}

#[allow(dead_code)]
#[ext_contract(ft)]
trait Token {
    fn ft_transfer_call_once(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
        msg: String,
    ) -> U128;
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_resolve_call_intent(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        sequence: U64,
        msg: String,
    ) -> CallReceipt;
}
#[allow(dead_code)]
#[ext_contract(callbacks)]
trait Callbacks {
    fn on_return(&mut self, operation_id: U64, amount: U128, sequence: U64) -> Redemption;
    fn on_recover_return(
        &mut self,
        operation_id: U64,
        sequence: U64,
    ) -> near_sdk::serde_json::Value;
    #[cfg(feature = "simulation-controls")]
    fn on_loss(&mut self, amount: U128) -> bool;
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Simulator {
    token_id: AccountId,
    vault_id: AccountId,
    controller_id: AccountId,
    loss_sink_id: AccountId,
    position: u128,
    busy: bool,
    last_supply: u64,
    last_redeem: u64,
    return_sequence: u64,
    return_amount: u128,
    return_used: Option<u128>,
    #[cfg(feature = "simulation-controls")]
    fail_return: bool,
    #[cfg(feature = "simulation-controls")]
    frozen: bool,
    #[cfg(feature = "simulation-controls")]
    supply_limit: u128,
}
#[near]
impl Simulator {
    #[init]
    pub fn new(
        token_id: AccountId,
        vault_id: AccountId,
        controller_id: AccountId,
        loss_sink_id: AccountId,
    ) -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "self initialization only"
        );
        Self::initialize(token_id, vault_id, controller_id, loss_sink_id)
    }

    #[init]
    pub fn new_from_factory(
        token_id: AccountId,
        vault_id: AccountId,
        controller_id: AccountId,
        loss_sink_id: AccountId,
    ) -> Self {
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
        Self::initialize(token_id, vault_id, controller_id, loss_sink_id)
    }

    fn initialize(
        token_id: AccountId,
        vault_id: AccountId,
        controller_id: AccountId,
        loss_sink_id: AccountId,
    ) -> Self {
        assert_ne!(vault_id, env::current_account_id());
        assert_ne!(loss_sink_id, env::current_account_id());
        assert_ne!(loss_sink_id, vault_id);
        Self {
            token_id,
            vault_id,
            controller_id,
            loss_sink_id,
            position: 0,
            busy: false,
            last_supply: 0,
            last_redeem: 0,
            return_sequence: 0,
            return_amount: 0,
            return_used: None,
            #[cfg(feature = "simulation-controls")]
            fail_return: false,
            #[cfg(feature = "simulation-controls")]
            frozen: false,
            #[cfg(feature = "simulation-controls")]
            supply_limit: u128::MAX,
        }
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        assert_eq!(
            env::predecessor_account_id(),
            self.token_id,
            "unsupported token"
        );
        if self.busy || amount.0 == 0 {
            return amount;
        }
        let accepted = if let Some(id) = msg
            .strip_prefix("supply:")
            .and_then(|s| s.parse::<u64>().ok())
        {
            if sender_id != self.vault_id || id <= self.last_supply {
                return amount;
            }
            self.last_supply = id;
            #[cfg(feature = "simulation-controls")]
            let accepted = amount.0.min(self.supply_limit);
            #[cfg(not(feature = "simulation-controls"))]
            let accepted = amount.0;
            accepted
        } else if msg == "fund_profit" && sender_id == self.controller_id && self.position > 0 {
            amount.0
        } else {
            return amount;
        };
        self.position = self
            .position
            .checked_add(accepted)
            .expect("position overflow");
        env::log_str(&format!("simulator credited {accepted} funded units"));
        U128(amount.0 - accepted)
    }

    /// Returns the promise through the token resolver AND our private finalizer.
    /// An error after sending remains busy; an outer failure is never retry evidence.
    #[payable]
    pub fn redeem_all(&mut self, operation_id: U64, sequence: U64) -> PromiseOrValue<Redemption> {
        assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.vault_id, "vault only");
        assert!(!self.busy, "strategy busy");
        #[cfg(feature = "simulation-controls")]
        if self.frozen {
            return PromiseOrValue::Value(Redemption {
                complete: false,
                amount: U128(0),
            });
        }
        assert!(
            operation_id.0 > self.last_redeem
                || (operation_id.0 == self.last_redeem
                    && self.return_used == Some(0)
                    && self.position > 0),
            "stale operation"
        );
        self.last_redeem = operation_id.0;
        let amount = self.position;
        assert!(sequence.0 > self.return_sequence, "stale return attempt");
        self.return_sequence = sequence.0;
        self.return_amount = amount;
        self.return_used = if amount == 0 { Some(0) } else { None };
        if amount == 0 {
            return PromiseOrValue::Value(Redemption {
                complete: true,
                amount: U128(0),
            });
        }
        self.busy = true;
        self.position = 0;
        PromiseOrValue::Promise(
            ft::ext(self.token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(Gas::from_tgas(70))
                .ft_transfer_call_once(
                    self.vault_id.clone(),
                    U128(amount),
                    U64(self.return_sequence),
                    format!("strategy_return:{}", operation_id.0),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(20))
                        .on_return(operation_id, U128(amount), U64(self.return_sequence)),
                ),
        )
    }
    #[private]
    pub fn on_return(&mut self, operation_id: U64, amount: U128, sequence: U64) -> Redemption {
        #[cfg(feature = "simulation-controls")]
        assert!(!self.fail_return, "injected simulator finalizer failure");
        assert_eq!(sequence.0, self.return_sequence, "stale return sequence");
        assert_eq!(amount.0, self.return_amount, "return amount changed");
        assert!(
            self.busy && self.last_redeem == operation_id.0,
            "stale callback"
        );
        assert_eq!(env::promise_results_count(), 1);
        let bytes = env::promise_result_checked(0, 64).expect("uncertain return; keep locked");
        let used: U128 = near_sdk::serde_json::from_slice(&bytes).expect("invalid resolver result");
        assert!(
            used.0 == 0 || used.0 == amount.0,
            "partial return remains locked"
        );
        self.return_used = Some(used.0);
        self.position = amount.0 - used.0;
        self.busy = false;
        Redemption {
            complete: used.0 == amount.0,
            amount: used,
        }
    }
    #[payable]
    pub fn recover_position(
        &mut self,
        operation_id: U64,
        sequence: U64,
    ) -> PromiseOrValue<near_sdk::serde_json::Value> {
        assert_one_yocto();
        assert_eq!(env::predecessor_account_id(), self.vault_id, "vault only");
        if !self.busy && sequence.0 > self.return_sequence && operation_id.0 >= self.last_redeem {
            // Fence an unexecuted redeem request before exposing a retryable state.
            self.last_redeem = operation_id.0;
            self.return_sequence = sequence.0;
            self.return_amount = self.position;
            self.return_used = Some(0);
        }
        if !self.busy || self.last_redeem != operation_id.0 || self.return_amount == 0 {
            return PromiseOrValue::Value(self.get_position());
        }
        ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(20))
            .ft_resolve_call_intent(
                self.vault_id.clone(),
                U128(self.return_amount),
                U64(self.return_sequence),
                format!("strategy_return:{}", operation_id.0),
            )
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_recover_return(operation_id, U64(self.return_sequence)),
            )
            .into()
    }
    #[private]
    pub fn on_recover_return(
        &mut self,
        operation_id: U64,
        sequence: U64,
    ) -> near_sdk::serde_json::Value {
        assert_eq!(self.last_redeem, operation_id.0, "stale redemption");
        assert_eq!(self.return_sequence, sequence.0, "stale return sequence");
        if !self.busy {
            return self.get_position();
        }
        let proof = if env::promise_results_count() == 1 {
            env::promise_result_checked(0, 1024)
                .ok()
                .and_then(|b| near_sdk::serde_json::from_slice::<CallReceipt>(&b).ok())
        } else {
            None
        };
        if let Some(used) = proof
            .filter(|r| {
                r.sender_id == env::current_account_id()
                    && r.receiver_id == self.vault_id
                    && r.sequence == sequence
                    && r.amount.0 == self.return_amount
                    && r.msg == format!("strategy_return:{}", operation_id.0)
            })
            .and_then(|r| r.used)
            .filter(|u| u.0 == 0 || u.0 == self.return_amount)
        {
            self.position = self.return_amount - used.0;
            self.return_used = Some(used.0);
            self.busy = false;
        }
        self.get_position()
    }
    #[cfg(feature = "simulation-controls")]
    pub fn test_set_return_fault(&mut self, enabled: bool) {
        self.controller();
        self.fail_return = enabled;
    }
    pub fn get_position(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"mode":"funded_simulator", "token_id":self.token_id,
            "vault_id":self.vault_id, "position":U128(self.position), "busy":self.busy,
            "last_redeem":U64(self.last_redeem), "last_supply":U64(self.last_supply),
            "controller_id":self.controller_id,"loss_sink_id":self.loss_sink_id, "return_used":self.return_used.map(U128), "return_sequence":U64(self.return_sequence)})
    }

    #[cfg(feature = "simulation-controls")]
    #[payable]
    pub fn set_controls(&mut self, frozen: bool, supply_limit: U128) {
        assert_one_yocto();
        self.controller();
        assert!(!self.busy);
        self.frozen = frozen;
        self.supply_limit = supply_limit.0;
    }
    #[cfg(feature = "simulation-controls")]
    #[payable]
    pub fn realize_loss(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        self.controller();
        assert!(
            !self.busy && amount.0 > 0 && amount.0 <= self.position,
            "invalid loss"
        );
        self.position -= amount.0;
        self.busy = true;
        ft::ext(self.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(20))
            .ft_transfer(
                self.loss_sink_id.clone(),
                amount,
                Some("simulated realized loss".into()),
            )
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(20))
                    .on_loss(amount),
            )
    }
    #[cfg(feature = "simulation-controls")]
    #[private]
    pub fn on_loss(&mut self, amount: U128) -> bool {
        assert!(self.busy);
        assert_eq!(env::promise_results_count(), 1);
        let success = match env::promise_result_checked(0, 64) {
            Ok(_) => true,
            Err(PromiseError::Failed) => {
                self.position = self.position.checked_add(amount.0).unwrap();
                false
            }
            Err(_) => return false,
        };
        self.busy = false;
        success
    }
}
#[cfg(feature = "simulation-controls")]
impl Simulator {
    fn controller(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.controller_id,
            "controller only"
        );
    }
}

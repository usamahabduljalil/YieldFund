//! Single-vault, funded test strategy. This is not a lending protocol.
//! Only the separate simulation-controls artifact exposes loss/delay/partial controls.
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

#[allow(dead_code)]
#[ext_contract(ft)]
trait Token {
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> U128;
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}
#[allow(dead_code)]
#[ext_contract(callbacks)]
trait Callbacks {
    fn on_return(&mut self, operation_id: U64, amount: U128) -> Redemption;
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
    pub fn redeem_all(&mut self, operation_id: U64) -> PromiseOrValue<Redemption> {
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
        assert!(operation_id.0 > self.last_redeem, "stale operation");
        self.last_redeem = operation_id.0;
        let amount = self.position;
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
                .ft_transfer_call(
                    self.vault_id.clone(),
                    U128(amount),
                    None,
                    format!("strategy_return:{}", operation_id.0),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(20))
                        .on_return(operation_id, U128(amount)),
                ),
        )
    }
    #[private]
    pub fn on_return(&mut self, operation_id: U64, amount: U128) -> Redemption {
        assert!(
            self.busy && self.last_redeem == operation_id.0,
            "stale callback"
        );
        assert_eq!(env::promise_results_count(), 1);
        let bytes = env::promise_result_checked(0, 64).expect("uncertain return; keep locked");
        let used: U128 = near_sdk::serde_json::from_slice(&bytes).expect("invalid resolver result");
        assert!(used.0 <= amount.0);
        self.position = amount.0 - used.0;
        self.busy = false;
        assert_eq!(used.0, amount.0, "return not fully accepted");
        Redemption {
            complete: true,
            amount: used,
        }
    }
    pub fn get_position(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({"mode":"funded_simulator", "token_id":self.token_id,
            "vault_id":self.vault_id, "position":U128(self.position), "busy":self.busy,
            "last_redeem":U64(self.last_redeem), "last_supply":U64(self.last_supply)})
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

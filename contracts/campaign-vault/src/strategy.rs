use super::*;

#[near]
impl Vault {
    #[payable]
    pub fn allocate_idle(&mut self, amount: U128) -> Promise {
        self.require_guardian();
        self.require_idle();
        assert!(!self.paused, "new risk paused");
        assert!(env::prepaid_gas().as_tgas() >= 160, "attach 160 Tgas");
        let strategy_id = self.config.strategy_id.clone().expect("no strategy");
        // Reallocation during impairment is allowed for the recovery demonstration.
        // Deposits and donations remain blocked until capital is fully backed.
        assert!(
            self.strategy_book == 0 && amount.0 > 0 && amount.0 <= self.cash,
            "invalid allocation"
        );
        Self::charge(Self::storage_cost(OPERATION_BYTES) + 1);
        let mut op = self.new_operation(
            Kind::Allocation,
            env::predecessor_account_id(),
            amount,
            U128(0),
        );
        self.cash -= amount.0;
        self.active = Some(op.id.0);
        op.stage = Stage::Allocating;
        self.save_operation(&mut op);
        self.emit(
            "allocation_started",
            Some(op.id),
            Some(&strategy_id),
            amount.0,
        );
        self.pending_transfer_sequence = op.version.0;
        ft::ext(self.config.token_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(90))
            .supply(
                strategy_id,
                amount,
                U64(self.pending_transfer_sequence),
                op.id,
            )
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_allocation(op.id, op.version),
            )
    }

    #[private]
    pub fn on_allocation(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::Allocating);
        #[cfg(feature = "test-faults")]
        assert!(
            !self.fail_allocation_callback,
            "injected allocation callback failure"
        );
        // The pinned token resolver returns used tokens only after refund resolution.
        // Failed/unknown outer promise can hide a successful hook: never restore blindly.
        let Some(used) = Self::result::<U128>(64).filter(|v| v.0 <= op.units.0) else {
            return self.uncertain(&mut op, "allocation_outcome_unknown");
        };
        self.finish_allocation(op, used)
    }

    #[payable]
    pub fn redeem_strategy(&mut self) -> Promise {
        self.require_idle();
        assert!(
            self.pending_redemption.is_none(),
            "advance existing redemption"
        );
        assert!(self.strategy_book > 0, "no allocated strategy");
        Self::charge(Self::storage_cost(OPERATION_BYTES) + 1);
        let mut op = self.new_operation(
            Kind::Redemption,
            env::predecessor_account_id(),
            U128(self.strategy_book),
            U128(0),
        );
        self.pending_redemption = Some(op.id.0);
        self.start_redemption(&mut op)
    }

    #[private]
    #[cfg(not(feature = "rhea"))]
    pub fn on_redemption(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::Redeeming);
        #[cfg(feature = "test-faults")]
        assert!(
            !self.fail_redemption_callback,
            "injected redemption callback interruption"
        );
        let Some(result) = Self::result::<RedemptionResult>(256) else {
            return self.uncertain(&mut op, "redemption_outcome_unknown");
        };
        if !result.complete && result.amount.0 == 0 && op.payout.0 == 0 {
            // This typed simulator result is emitted only before any outgoing call.
            op.stage = Stage::RetryableFailure;
            op.error = Some("liquidity_unavailable".into());
            self.active = None;
            self.save_operation(&mut op);
            return false;
        }
        if !result.complete || result.amount != op.payout {
            return self.uncertain(&mut op, "redemption_evidence_mismatch");
        }
        self.finish_redemption(op)
    }

    #[payable]
    pub fn distribute_yield(&mut self, max_amount: U128) -> Promise {
        self.require_guardian();
        self.require_idle();
        Self::require_gas();
        assert!(
            !self.paused && self.strategy_book == 0,
            "settlement unavailable"
        );
        assert!(
            max_amount.0 > 0 && self.eligible.min(self.cash.saturating_sub(self.nominal)) > 0,
            "no eligible yield"
        );
        Self::charge(Self::storage_cost(OPERATION_BYTES) + 1);
        let mut op = self.new_operation(
            Kind::Donation,
            self.config.beneficiary_id.clone(),
            max_amount,
            U128(0),
        );
        self.start_reconcile(&mut op)
    }

    #[private]
    pub fn on_donation(&mut self, operation_id: U64, version: U64) -> bool {
        self.finalize_donation(operation_id, version)
    }
}

impl Vault {
    pub(super) fn finish_allocation(&mut self, mut op: Operation, used: U128) -> bool {
        self.cash = self
            .cash
            .checked_add(op.units.0 - used.0)
            .expect("cash overflow");
        self.strategy_book = used.0;
        op.payout = used;
        self.active = None;
        op.stage = Stage::Completed;
        self.save_operation(&mut op);
        self.emit("allocation_completed", Some(op.id), None, used.0);
        self.pending_transfer_sequence = 0;
        true
    }
    pub(super) fn finish_redemption(&mut self, mut op: Operation) -> bool {
        // Pinned simulator returns complete only after position=0 and token resolver.
        // Cash was credited exactly once by the authenticated return hook, never here.
        if op.payout.0 >= self.strategy_book {
            self.eligible = self
                .eligible
                .checked_add(op.payout.0 - self.strategy_book)
                .expect("yield overflow");
        } else {
            self.eligible = self
                .eligible
                .saturating_sub(self.strategy_book - op.payout.0);
        }
        self.strategy_book = 0;
        self.pending_redemption = None;
        self.eligible = self.eligible.min(self.cash.saturating_sub(self.nominal));
        self.active = None;
        op.stage = Stage::Completed;
        self.checkpoint_at = env::block_timestamp();
        self.save_operation(&mut op);
        self.emit("strategy_redeemed", Some(op.id), None, op.payout.0);
        true
    }

    fn finalize_donation(&mut self, operation_id: U64, version: U64) -> bool {
        let op = self.expected(operation_id, version, Stage::TransferPending);
        assert_eq!(op.kind, Kind::Donation);
        #[cfg(feature = "test-faults")]
        assert!(!self.fail_callback, "injected callback interruption");
        self.finish_payment_result(op, false)
    }
}

impl Vault {
    #[cfg(not(feature = "rhea"))]
    pub(super) fn start_redemption(&mut self, op: &mut Operation) -> Promise {
        assert_eq!(self.pending_redemption, Some(op.id.0), "stale redemption");
        assert!(env::prepaid_gas().as_tgas() >= 220, "attach 220 Tgas");
        self.active = Some(op.id.0);
        op.stage = Stage::Redeeming;
        op.error = None;
        self.save_operation(op);
        self.pending_transfer_sequence = op.version.0;
        strategy::ext(self.config.strategy_id.clone().expect("no strategy"))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(150))
            .redeem_all(op.id, U64(self.pending_transfer_sequence))
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_redemption(op.id, op.version),
            )
    }
    pub(super) fn settle_donation(&mut self, mut op: Operation) -> PromiseOrValue<bool> {
        let amount = op
            .units
            .0
            .min(self.eligible)
            .min(self.cash.saturating_sub(self.nominal));
        let mut snapshot = self.snapshot();
        snapshot.pending = false;
        if self.paused || snapshot.reserve_donation(amount, self.eligible).is_err() {
            op.stage = Stage::RetryableFailure;
            op.error = Some("no_eligible_yield".into());
            self.active = None;
            self.save_operation(&mut op);
            return PromiseOrValue::Value(false);
        }
        self.donated
            .checked_add(amount)
            .expect("donation history overflow");
        self.cash -= amount;
        self.eligible -= amount;
        op.payout = U128(amount);
        op.stage = Stage::TransferPending;
        op.error = None;
        self.save_operation(&mut op);
        self.emit("donation_started", Some(op.id), Some(&op.owner_id), amount);
        self.pending_transfer_sequence = op.version.0;
        PromiseOrValue::Promise(
            ft::ext(self.config.token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(TRANSFER_GAS)
                .send_payment(
                    self.config.beneficiary_id.clone(),
                    U128(amount),
                    U64(self.pending_transfer_sequence),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(FINALIZE_GAS)
                        .on_donation(op.id, op.version),
                ),
        )
    }
    pub(super) fn result<T: near_sdk::serde::de::DeserializeOwned>(limit: usize) -> Option<T> {
        if env::promise_results_count() != 1 {
            return None;
        }
        env::promise_result_checked(0, limit)
            .ok()
            .and_then(|b| near_sdk::serde_json::from_slice(&b).ok())
    }
    pub(super) fn uncertain(&mut self, op: &mut Operation, error: &str) -> bool {
        op.stage = Stage::NeedsReconciliation;
        op.error = Some(error.into());
        self.save_operation(op);
        false
    }
}

impl ft::TokenExt {
    fn supply(self, receiver: AccountId, amount: U128, sequence: U64, operation: U64) -> Promise {
        #[cfg(not(feature = "rhea"))]
        {
            self.ft_transfer_call_once(
                receiver,
                amount,
                sequence,
                format!("supply:{}", operation.0),
            )
        }
        #[cfg(feature = "rhea")]
        {
            let _ = (sequence, operation);
            // Empty message means supply only: no collateral, borrow, swap or oracle action.
            self.ft_transfer_call(receiver, amount, None, String::new())
        }
    }
}

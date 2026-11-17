//! Recovery never accepts caller-supplied balances, status or receipt assertions.
use super::*;

#[near(serializers = [json])]
pub struct TransferReceipt {
    pub sender_id: AccountId,
    pub receiver_id: AccountId,
    pub sequence: U64,
    pub amount: U128,
    pub applied: bool,
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

#[near(serializers = [json])]
pub struct StrategyEvidence {
    pub mode: String,
    pub token_id: AccountId,
    pub vault_id: AccountId,
    pub position: U128,
    pub busy: bool,
    pub last_redeem: U64,
    pub return_sequence: U64,
    #[serde(default)]
    pub return_used: Option<U128>,
}

#[near]
impl Vault {
    /// Permissionless, rate-limited restart of a read or proof of completed redemption.
    /// The supplied version prevents a stale UI action from superseding newer work.
    #[payable]
    #[cfg(not(feature = "rhea"))]
    pub fn recover_operation(&mut self, operation_id: U64, version: U64) -> Promise {
        assert_one_yocto();
        Self::require_gas();
        assert_eq!(self.active, Some(operation_id.0), "inactive operation");
        let mut op = self.operation(operation_id.0);
        assert_eq!(op.version, version, "stale operation version");
        assert!(
            env::block_timestamp().saturating_sub(op.updated_at.0) >= RECOVERY_DELAY_NS,
            "recovery cooldown: wait five minutes"
        );
        if op.kind == Kind::Allocation
            && matches!(op.stage, Stage::Allocating | Stage::NeedsReconciliation)
        {
            assert!(
                self.pending_transfer_sequence > 0,
                "missing allocation intent"
            );
            op.stage = Stage::Allocating;
            self.save_operation(&mut op);
            return ft::ext(self.config.token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(TRANSFER_GAS)
                .ft_resolve_call_intent(
                    self.config.strategy_id.clone().expect("no strategy"),
                    op.units,
                    U64(self.pending_transfer_sequence),
                    format!("supply:{}", op.id.0),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(FINALIZE_GAS)
                        .on_recovery_allocation(op.id, op.version),
                );
        }
        if op.stage == Stage::TransferPending
            && matches!(op.kind, Kind::Withdrawal | Kind::Donation)
        {
            assert!(
                op.payout.0 > 0 && self.pending_transfer_sequence > 0,
                "missing transfer intent"
            );
            // Preserve the original token sequence, but invalidate every old vault callback.
            // The token atomically returns the payment or fences an unexecuted attempt.
            self.save_operation(&mut op);
            return ft::ext(self.config.token_id.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(TRANSFER_GAS)
                .ft_resolve_once(
                    op.owner_id.clone(),
                    op.payout,
                    U64(self.pending_transfer_sequence),
                )
                .then(
                    callbacks::ext(env::current_account_id())
                        .with_static_gas(FINALIZE_GAS)
                        .on_recovery_transfer(op.id, op.version),
                );
        }
        if op.stage == Stage::Reconciling
            && matches!(
                op.kind,
                Kind::Checkpoint | Kind::Withdrawal | Kind::Donation
            )
        {
            assert_eq!(self.strategy_book, 0, "redeem strategy fully first");
            assert_eq!(op.payout.0, 0, "outgoing transfer evidence required");
            // A balance query has no outgoing effect. Bumping the version makes
            // every older callback fail before it can reserve or send anything.
            self.emit("balance_recovery_requested", Some(op.id), None, 0);
            return self.start_reconcile(&mut op);
        }
        assert!(
            op.kind == Kind::Redemption
                && matches!(op.stage, Stage::Redeeming | Stage::NeedsReconciliation),
            "no automatic recovery for this stage"
        );
        assert_eq!(self.pending_redemption, Some(op.id.0), "stale redemption");
        // Preserve the accepting stage so a late authenticated return can still
        // arrive. Never resend redeem_all, even if the original promise is slow.
        op.stage = Stage::Redeeming;
        op.error = Some("checking_redemption_evidence".into());
        self.save_operation(&mut op);
        self.emit("redemption_recovery_requested", Some(op.id), None, 0);
        strategy::ext(self.config.strategy_id.clone().expect("no strategy"))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(60))
            .recover_position(op.id, U64(self.pending_transfer_sequence))
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_recovery_redemption(op.id, op.version),
            )
    }

    #[private]
    #[cfg(not(feature = "rhea"))]
    pub fn on_recovery_redemption(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::Redeeming);
        assert_eq!(op.kind, Kind::Redemption, "wrong recovery kind");
        assert_eq!(self.pending_redemption, Some(op.id.0), "stale redemption");
        let evidence = if env::promise_results_count() == 1 {
            env::promise_result_checked(0, 2048)
                .ok()
                .and_then(|bytes| near_sdk::serde_json::from_slice::<StrategyEvidence>(&bytes).ok())
        } else {
            None
        };
        let evidence = evidence.filter(|e| {
            e.mode == "funded_simulator"
                && e.token_id == self.config.token_id
                && e.vault_id == env::current_account_id()
                && e.last_redeem == op.id
                && e.return_sequence.0 == self.pending_transfer_sequence
                && !e.busy
        });
        if evidence
            .as_ref()
            .is_some_and(|e| e.position.0 > 0 && e.return_used == Some(U128(0)))
            && op.payout.0 == 0
        {
            op.stage = Stage::RetryableFailure;
            op.error = Some("strategy_return_cancelled".into());
            self.active = None;
            self.save_operation(&mut op);
            return false;
        }
        let proven = evidence.is_some_and(|e| e.position.0 == 0);
        if !proven {
            // Failed/busy/mismatched reads are not evidence of no transfer.
            // Keep reservations, the return hook and the cooldown intact.
            op.error = Some("redemption_evidence_unavailable".into());
            self.save_operation(&mut op);
            return false;
        }
        // In the pinned simulator, last_redeem=id + !busy + position=0 can
        // only follow a successful full resolver/finalizer or a zero position
        // redemption. The vault already recorded any nonzero return itself.
        // Never credit cash here or accept a caller-provided amount.
        op.error = None;
        self.finish_redemption(op)
    }

    #[private]
    #[cfg(not(feature = "rhea"))]
    pub fn on_recovery_transfer(&mut self, operation_id: U64, version: U64) -> bool {
        let op = self.expected(operation_id, version, Stage::TransferPending);
        assert!(
            matches!(op.kind, Kind::Withdrawal | Kind::Donation),
            "wrong payment kind"
        );
        self.finish_payment_result(op, true)
    }

    #[private]
    #[cfg(not(feature = "rhea"))]
    pub fn on_recovery_allocation(&mut self, operation_id: U64, version: U64) -> bool {
        let mut op = self.expected(operation_id, version, Stage::Allocating);
        assert_eq!(op.kind, Kind::Allocation);
        let proof = Self::result::<CallReceipt>(1024).filter(|r| {
            r.sender_id == env::current_account_id()
                && Some(&r.receiver_id) == self.config.strategy_id.as_ref()
                && r.sequence.0 == self.pending_transfer_sequence
                && r.amount == op.units
                && r.msg == format!("supply:{}", op.id.0)
        });
        if let Some(used) = proof.and_then(|r| r.used).filter(|v| v.0 <= op.units.0) {
            self.finish_allocation(op, used)
        } else {
            self.uncertain(&mut op, "allocation_evidence_unavailable")
        }
    }
}

impl Vault {
    pub(super) fn finish_payment_result(&mut self, mut op: Operation, recovery: bool) -> bool {
        let result = if env::promise_results_count() == 1 {
            env::promise_result_checked(0, 1024)
        } else {
            Err(PromiseError::TooLong(0))
        };
        #[cfg(not(feature = "rhea"))]
        let applied = match result {
            Ok(bytes) => near_sdk::serde_json::from_slice::<TransferReceipt>(&bytes)
                .ok()
                .filter(|r| {
                    r.sender_id == env::current_account_id()
                        && r.receiver_id == op.owner_id
                        && r.amount == op.payout
                        && r.sequence.0 == self.pending_transfer_sequence
                })
                .map(|r| r.applied),
            // Only failure of the ORIGINAL atomic transfer proves no payment.
            // Failure of an evidence read/cancellation proves nothing.
            Err(PromiseError::Failed) if !recovery => Some(false),
            _ => None,
        };
        #[cfg(feature = "rhea")]
        let applied = match result {
            // Standard NEP-141 transfer returns unit, not the demo token receipt.
            Ok(bytes) if !recovery && (bytes.is_empty() || bytes == b"null") => Some(true),
            Err(PromiseError::Failed) if !recovery => Some(false),
            _ => None,
        };
        let Some(applied) = applied else {
            op.error = Some("payment_evidence_unavailable".into());
            self.save_operation(&mut op);
            return false;
        };
        if op.kind == Kind::Withdrawal {
            let mut p = self.positions.get(&op.owner_id).expect("position missing");
            if applied {
                p.withdrawn.0 = p
                    .withdrawn
                    .0
                    .checked_add(op.payout.0)
                    .expect("history overflow");
            } else {
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
            }
            self.positions.insert(&op.owner_id, &p);
        } else {
            assert_eq!(op.kind, Kind::Donation);
            if applied {
                self.donated = self
                    .donated
                    .checked_add(op.payout.0)
                    .expect("history overflow");
            } else {
                self.cash = self.cash.checked_add(op.payout.0).expect("cash overflow");
                self.eligible = self
                    .eligible
                    .checked_add(op.payout.0)
                    .expect("yield overflow");
            }
        }
        op.stage = if applied {
            Stage::Completed
        } else {
            Stage::RetryableFailure
        };
        op.error = if applied {
            None
        } else {
            Some("token_transfer_failed".into())
        };
        self.active = None;
        self.pending_transfer_sequence = 0;
        self.save_operation(&mut op);
        self.emit(
            if applied {
                "payment_completed"
            } else {
                "payment_restored"
            },
            Some(op.id),
            Some(&op.owner_id),
            op.payout.0,
        );
        applied
    }
}

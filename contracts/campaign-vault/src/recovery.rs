//! Recovery never accepts caller-supplied balances, status or receipt assertions.
use super::*;

#[near(serializers = [json])]
pub struct StrategyEvidence {
    pub mode: String,
    pub token_id: AccountId,
    pub vault_id: AccountId,
    pub position: U128,
    pub busy: bool,
    pub last_redeem: U64,
}

#[near]
impl Vault {
    /// Permissionless, rate-limited restart of a read or proof of completed redemption.
    /// The supplied version prevents a stale UI action from superseding newer work.
    #[payable]
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
            .with_static_gas(Gas::from_tgas(10))
            .get_position()
            .then(
                callbacks::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(30))
                    .on_recovery_redemption(op.id, op.version),
            )
    }

    #[private]
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
        let proven = evidence.is_some_and(|e| {
            e.mode == "funded_simulator"
                && e.token_id == self.config.token_id
                && e.vault_id == env::current_account_id()
                && e.last_redeem == op.id
                && !e.busy
                && e.position.0 == 0
        });
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
}

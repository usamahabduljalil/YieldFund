use super::*;

impl Harness {
    pub(super) async fn recovery_cooldown(&self, op: &Value) -> Result<()> {
        let ready = op["updated_at"].as_str().unwrap().parse::<u64>()? + 300_000_000_000;
        // Sandbox block skipping is not a wall-clock sleep. Verify timestamp
        // progress explicitly, including after a previous fast-forward.
        for _ in 0..4 {
            self._sandbox.fast_forward(2000).await?;
            let block = browser_fixture::rpc(
                &self._sandbox.rpc_addr,
                "block",
                json!({"finality":"final"}),
            )?;
            let now = block["header"]["timestamp_nanosec"]
                .as_str()
                .unwrap()
                .parse::<u64>()?;
            if now >= ready {
                return Ok(());
            }
        }
        anyhow::bail!("Sandbox timestamp did not reach recovery cooldown")
    }
    async fn read_fault(&self, stage: &str, enabled: bool) -> Result<()> {
        self.call(
            "guardian",
            "vault",
            "test_set_read_fault",
            json!({"stage":stage,"enabled":enabled}),
            0,
        )
        .await?
        .assert_success();
        Ok(())
    }
    async fn recover(&self, id: &str, version: &Value) -> Result<ExecutionFinalResult> {
        self.call(
            "bob",
            "vault",
            "recover_operation",
            json!({"operation_id":id,"version":version}),
            1,
        )
        .await
    }
}

#[tokio::test]
async fn interrupted_balance_reads_recover_without_duplicate_payment() -> Result<()> {
    let h = Harness::configured(true, true, false).await?;
    h.seeded().await?;
    h.allocate(1000).await?;
    h.profit(30).await?;
    h.redeem().await?;
    h.read_fault("balance", true).await?;
    let id = h.request("alice", 200).await?;
    h.advance(&id).await?.assert_failure();
    let stuck = h.operation(&id).await?;
    assert_eq!(stuck["stage"], "reconciling");
    assert_eq!(h.balance("token", "alice").await?, 1000 * UNIT);
    h.recover(&id, &stuck["version"]).await?.assert_failure();
    h.read_fault("balance", false).await?;
    h.recovery_cooldown(&stuck).await?;
    h.recover(&id, &stuck["version"]).await?.assert_success();
    assert_eq!(h.operation(&id).await?["stage"], "completed");
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    h.recover(&id, &stuck["version"]).await?.assert_failure();
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    assert_eq!(h.accounting().await?["nominal"], amount(800));

    h.read_fault("balance", true).await?;
    h.operator("distribute_yield", json!({"max_amount":amount(30)}))
        .await?
        .assert_failure();
    let a = h.accounting().await?;
    let id = a["active_operation"].as_str().unwrap();
    let stuck = h.operation(id).await?;
    assert_eq!(stuck["stage"], "reconciling");
    assert_eq!(h.balance("token", "treasury").await?, 0);
    h.read_fault("balance", false).await?;
    h.recovery_cooldown(&stuck).await?;
    h.recover(id, &stuck["version"]).await?.assert_success();
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    assert_eq!(h.accounting().await?["donated"], amount(30));
    h.recover(id, &stuck["version"]).await?.assert_failure();
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.save("recovery-balance-withdrawal-donation")
}

#[tokio::test]
async fn interrupted_redemption_is_proven_from_strategy_without_resending() -> Result<()> {
    for total_loss in [false, true] {
        let h = Harness::configured(true, true, false).await?;
        h.seeded().await?;
        h.allocate(1000).await?;
        if total_loss {
            h.call(
                "guardian",
                "strategy",
                "realize_loss",
                json!({"amount":amount(1000)}),
                1,
            )
            .await?
            .assert_success();
        } else {
            h.profit(30).await?;
        }
        h.read_fault("redemption", true).await?;
        h.operator("redeem_strategy", json!({}))
            .await?
            .assert_failure();
        let a = h.accounting().await?;
        let id = a["active_operation"].as_str().unwrap();
        let stuck = h.operation(id).await?;
        assert_eq!(stuck["stage"], "redeeming");
        let returned = if total_loss { 0 } else { 1030 };
        assert_eq!(stuck["payout"], amount(returned));
        assert_eq!(a["eligible_yield"], "0");
        assert_eq!(h.balance("token", "vault").await?, returned * UNIT);
        let strategy = h.view("strategy", "get_position", json!({})).await?;
        assert_eq!(strategy["busy"], false);
        assert_eq!(strategy["last_redeem"], id);
        h.call(
            "bob",
            "vault",
            "on_recovery_redemption",
            json!({"operation_id":id,"version":stuck["version"]}),
            0,
        )
        .await?
        .assert_failure();
        h.recover(id, &stuck["version"]).await?.assert_failure();
        h.recovery_cooldown(&stuck).await?;
        // Recovery works even while the original fault remains enabled: it
        // queries durable evidence, rather than replaying the failed callback.
        h.recover(id, &stuck["version"]).await?.assert_success();
        let done = h.accounting().await?;
        assert_eq!(done["strategy_book"], "0");
        assert_eq!(done["cash"], amount(returned));
        assert_eq!(done["nominal"], amount(1000));
        assert_eq!(
            done["eligible_yield"],
            amount(if total_loss { 0 } else { 30 })
        );
        assert_eq!(done["settled"], true);
        h.recover(id, &stuck["version"]).await?.assert_failure();
        assert_eq!(h.balance("token", "vault").await?, returned * UNIT);
        if !total_loss {
            h.donate(30).await?;
        }
        h.save(if total_loss {
            "recovery-zero-return"
        } else {
            "recovery-funded-redemption"
        })?;
    }
    Ok(())
}

#[tokio::test]
async fn lost_payment_callback_recovers_from_atomic_token_receipt() -> Result<()> {
    let h = Harness::new(true).await?;
    h.seeded().await?;
    let id = h.request("alice", 200).await?;
    h.call("guardian", "vault", "test_interrupt_callback", json!({}), 0)
        .await?
        .assert_success();
    h.advance(&id).await?.assert_failure();
    let op = h.operation(&id).await?;
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    h.recovery_cooldown(&op).await?;
    h.recover(&id, &op["version"]).await?.assert_success();
    assert_eq!(h.operation(&id).await?["stage"], "completed");
    assert!(h.accounting().await?["active_operation"].is_null());
    h.recover(&id, &op["version"]).await?.assert_failure();
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    h.save("recovery-proves-unknown-payment")
}

#[tokio::test]
async fn failed_payment_with_lost_callback_cancels_then_retries_once() -> Result<()> {
    let h = Harness::new(true).await?;
    h.seeded().await?;
    let id = h.request("alice", 200).await?;
    h.call(
        "alice",
        "token",
        "storage_unregister",
        json!({"force":true}),
        1,
    )
    .await?
    .assert_success();
    h.read_fault("payment", true).await?;
    h.advance(&id).await?.assert_failure();
    let op = h.operation(&id).await?;
    h.recovery_cooldown(&op).await?;
    h.recover(&id, &op["version"]).await?.assert_success();
    assert_eq!(h.operation(&id).await?["stage"], "retryable_failure");
    assert_eq!(h.accounting().await?["nominal"], amount(1000));
    assert_eq!(h.accounting().await?["cash"], amount(1000));
    let cancelled = h
        .view(
            "token",
            "get_transfer_receipt",
            json!({"sender_id":"vault.test"}),
        )
        .await?;
    assert_eq!(cancelled["applied"], false);
    h.register_token("token", "alice").await?;
    // The old attempt is fenced even after the original reason for failure is gone.
    h.call(
        "vault",
        "token",
        "ft_transfer_once",
        json!({"receiver_id":"alice.test","amount":amount(200),"sequence":cancelled["sequence"]}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.balance("token", "alice").await?, 0);
    h.read_fault("payment", false).await?;
    h.advance(&id).await?.assert_success();
    assert_eq!(h.balance("token", "alice").await?, 200 * UNIT);
    h.advance(&id).await?.assert_failure();
    h.save("cancelled-payment-late-attempt-and-retry")
}

#[tokio::test]
async fn allocation_and_simulator_finalizer_recover_from_resolver_receipts() -> Result<()> {
    let h = Harness::configured(true, true, false).await?;
    h.seeded().await?;
    h.call(
        "guardian",
        "strategy",
        "set_controls",
        json!({"frozen":false,"supply_limit":amount(600)}),
        1,
    )
    .await?
    .assert_success();
    h.read_fault("allocation", true).await?;
    h.operator("allocate_idle", json!({"amount":amount(1000)}))
        .await?
        .assert_failure();
    let a = h.accounting().await?;
    let id = a["active_operation"].as_str().unwrap();
    let op = h.operation(id).await?;
    assert_eq!(h.balance("token", "vault").await?, 400 * UNIT);
    h.recovery_cooldown(&op).await?;
    h.recover(id, &op["version"]).await?.assert_success();
    assert_eq!(h.accounting().await?["cash"], amount(400));
    assert_eq!(h.accounting().await?["strategy_book"], amount(600));
    h.recover(id, &op["version"]).await?.assert_failure();
    h.profit(30).await?;
    h.call(
        "guardian",
        "strategy",
        "test_set_return_fault",
        json!({"enabled":true}),
        0,
    )
    .await?
    .assert_success();
    // The vault records uncertainty after a nested finalizer failure; its outer
    // receipt may succeed with false. The state assertions below prove the fault.
    let _ = h.operator("redeem_strategy", json!({})).await?;
    let a = h.accounting().await?;
    let id = a["active_operation"].as_str().unwrap();
    let op = h.operation(id).await?;
    assert_eq!(op["payout"], amount(630));
    assert_eq!(
        h.view("strategy", "get_position", json!({})).await?["busy"],
        true
    );
    h.recovery_cooldown(&op).await?;
    h.recover(id, &op["version"]).await?.assert_success();
    assert_eq!(
        h.view("strategy", "get_position", json!({})).await?["busy"],
        false
    );
    assert_eq!(h.accounting().await?["cash"], amount(1030));
    assert_eq!(h.accounting().await?["eligible_yield"], amount(30));
    h.read_fault("payment", true).await?;
    h.operator("distribute_yield", json!({"max_amount":amount(30)}))
        .await?
        .assert_failure();
    let a = h.accounting().await?;
    let id = a["active_operation"].as_str().unwrap();
    let op = h.operation(id).await?;
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.recovery_cooldown(&op).await?;
    h.recover(id, &op["version"]).await?.assert_success();
    assert_eq!(h.accounting().await?["donated"], amount(30));
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.recover(id, &op["version"]).await?.assert_failure();
    h.save("allocation-simulator-and-donation-recovery")
}

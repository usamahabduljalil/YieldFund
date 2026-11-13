use super::*;

impl Harness {
    pub(super) async fn operator(&self, method: &str, args: Value) -> Result<ExecutionFinalResult> {
        let costs = self.view("vault", "storage_costs", json!({})).await?;
        self.call(
            "guardian",
            "vault",
            method,
            args,
            costs["operation"].as_str().unwrap().parse()?,
        )
        .await
    }
    pub(super) async fn seeded(&self) -> Result<()> {
        self.register("alice").await?;
        self.fund("token", "alice", 2000).await?;
        self.deposit("token", "alice", 1000, "deposit")
            .await?
            .assert_success();
        Ok(())
    }
    pub(super) async fn allocate(&self, tokens: u128) -> Result<()> {
        self.operator("allocate_idle", json!({"amount":amount(tokens)}))
            .await?
            .assert_success();
        Ok(())
    }
    pub(super) async fn profit(&self, tokens: u128) -> Result<()> {
        assert_eq!(
            self.call(
                "guardian",
                "token",
                "ft_transfer_call",
                json!({"receiver_id":"strategy.test","amount":amount(tokens),"msg":"fund_profit"}),
                1
            )
            .await?
            .json::<String>()?,
            amount(tokens)
        );
        Ok(())
    }
    async fn controls(&self, frozen: bool, limit: u128) -> Result<()> {
        self.call(
            "guardian",
            "strategy",
            "set_controls",
            json!({"frozen":frozen,"supply_limit":amount(limit)}),
            1,
        )
        .await?
        .assert_success();
        Ok(())
    }
    pub(super) async fn redeem(&self) -> Result<()> {
        self.operator("redeem_strategy", json!({}))
            .await?
            .assert_success();
        Ok(())
    }
    pub(super) async fn donate(&self, tokens: u128) -> Result<()> {
        self.operator("distribute_yield", json!({"max_amount":amount(tokens)}))
            .await?
            .assert_success();
        Ok(())
    }
    async fn request_min(&self, units: u128, minimum: u128) -> Result<String> {
        let costs = self.view("vault", "storage_costs", json!({})).await?;
        Ok(self
            .call(
                "alice",
                "vault",
                "request_withdraw",
                json!({"units":amount(units),"min_amount":amount(minimum)}),
                costs["operation"].as_str().unwrap().parse()?,
            )
            .await?
            .json()?)
    }
    pub(super) async fn advance(&self, id: &str) -> Result<ExecutionFinalResult> {
        self.call(
            "bob",
            "vault",
            "advance_operation",
            json!({"operation_id":id}),
            1,
        )
        .await
    }
    fn save_lifecycle(&self, name: &str) -> Result<()> {
        let dir = evidence_dir();
        std::fs::create_dir_all(&dir)?;
        std::fs::write(
            dir.join(format!("{name}.json")),
            serde_json::to_vec_pretty(&json!({
                "network":"ephemeral local sandbox", "sandbox_version":"2.14.0", "public_network":false,
                "test":name,"transactions":self.evidence.borrow().as_slice()
            }))?,
        )?;
        Ok(())
    }
}

#[tokio::test]
async fn funded_profit_fixed_dao_and_two_member_payment() -> Result<()> {
    let h = Harness::configured(false, true, true).await?;
    h.seeded().await?;
    h.allocate(1000).await?;
    assert_eq!(h.balance("token", "vault").await?, 0);
    assert_eq!(h.balance("token", "strategy").await?, 1000 * UNIT);
    h.profit(30).await?;
    // A direct, unclassified transfer to either contract must not become yield.
    h.fund("token", "strategy", 50).await?;
    h.fund("token", "vault", 40).await?;
    h.operator("distribute_yield", json!({"max_amount":amount(30)}))
        .await?
        .assert_failure();
    assert_eq!(
        h.deposit("token", "alice", 10, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    h.redeem().await?;
    assert_eq!(h.balance("token", "strategy").await?, 50 * UNIT);
    assert_eq!(h.accounting().await?["eligible_yield"], amount(30));
    h.donate(100).await?;
    let a = h.accounting().await?;
    assert_eq!(a["cash"], amount(1000));
    assert_eq!(a["excluded"], amount(40));
    assert_eq!(a["donated"], amount(30));
    assert_eq!(a["nominal"], amount(1000));
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.operator("distribute_yield", json!({"max_amount":amount(1)}))
        .await?
        .assert_failure();
    let policy = h.view("treasury", "get_policy", json!({})).await?;
    assert_eq!(policy["default_vote_policy"]["threshold"], "2");
    assert_eq!(policy["default_vote_policy"]["quorum"], "2");
    assert_eq!(
        policy["roles"][0]["kind"]["Group"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let kind = json!({"Transfer":{"token_id":"token.test","receiver_id":"recipient.test","amount":amount(20),"msg":null}});
    let proposal = json!({"proposal":{"description":"Fictional commons maintenance","kind":kind}});
    let bond = policy["proposal_bond"].as_str().unwrap().parse()?;
    h.call("alice", "treasury", "add_proposal", proposal.clone(), bond)
        .await?
        .assert_failure();
    h.call("member1", "treasury", "add_proposal", proposal.clone(), 0)
        .await?
        .assert_failure();
    let id = h
        .call("member1", "treasury", "add_proposal", proposal, bond)
        .await?
        .json::<u64>()?;
    let vote = json!({"id":id,"action":"VoteApprove","proposal":kind});
    let mut changed = vote.clone();
    changed["proposal"]["Transfer"]["receiver_id"] = json!("bob.test");
    h.call("member1", "treasury", "act_proposal", changed, 0)
        .await?
        .assert_failure();
    h.call("alice", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_failure();
    h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_success();
    assert_eq!(h.balance("token", "recipient").await?, 0);
    assert_eq!(
        h.view("treasury", "get_proposal", json!({"id":id})).await?["status"],
        "InProgress"
    );
    h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_failure();
    let paid = h
        .call("member2", "treasury", "act_proposal", vote.clone(), 0)
        .await?;
    assert!(paid
        .logs()
        .iter()
        .any(|l| l.contains("ft_transfer") && l.contains("recipient.test")));
    paid.assert_success();
    assert_eq!(
        h.view("treasury", "get_proposal", json!({"id":id})).await?["status"],
        "Approved"
    );
    assert_eq!(h.balance("token", "recipient").await?, 20 * UNIT);
    assert_eq!(h.balance("token", "treasury").await?, 10 * UNIT);
    h.call("member3", "treasury", "act_proposal", vote, 0)
        .await?
        .assert_failure();
    let exit = h.request("alice", 200).await?;
    h.advance(&exit).await?.assert_success();
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    assert_eq!(h.accounting().await?["cash"], amount(800));
    h.save_lifecycle("funded-yield-dao-payment")
}

#[tokio::test]
async fn actual_loss_delayed_redemption_minimum_and_recovery() -> Result<()> {
    let h = Harness::configured(false, true, false).await?;
    h.seeded().await?;
    h.allocate(1000).await?;
    h.call(
        "guardian",
        "strategy",
        "realize_loss",
        json!({"amount":amount(100)}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.balance("token", "sink").await?, 100 * UNIT);
    assert_eq!(h.balance("token", "strategy").await?, 900 * UNIT);
    h.controls(true, 10000).await?;
    let exit = h.request("alice", 200).await?;
    h.advance(&exit).await?.assert_failure();
    h.redeem().await?;
    // Allocation=1, withdrawal=2, delayed redemption=3.
    assert_eq!(h.operation("3").await?["stage"], "retryable_failure");
    assert_eq!(h.accounting().await?["queued_redemption"], "3");
    h.operator("redeem_strategy", json!({}))
        .await?
        .assert_failure();
    assert_eq!(h.accounting().await?["eligible_yield"], "0");
    assert_eq!(h.balance("token", "alice").await?, 1000 * UNIT);
    h.controls(false, 10000).await?;
    h.advance("3").await?.assert_success();
    h.advance("3").await?.assert_failure();
    assert_eq!(h.accounting().await?["shortfall"], amount(100));
    h.advance(&exit).await?.assert_success();
    assert_eq!(h.operation(&exit).await?["stage"], "requested");
    assert_eq!(h.operation(&exit).await?["error"], "minimum_not_met");
    h.call(
        "alice",
        "vault",
        "cancel_withdraw",
        json!({"operation_id":exit}),
        1,
    )
    .await?
    .assert_success();
    let exit = h.request_min(200, 180).await?;
    h.advance(&exit).await?.assert_success();
    assert_eq!(h.balance("token", "alice").await?, 1180 * UNIT);
    assert_eq!(h.accounting().await?["cash"], amount(720));
    assert_eq!(h.accounting().await?["nominal"], amount(800));
    assert_eq!(
        h.deposit("token", "alice", 10, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    h.operator("distribute_yield", json!({"max_amount":amount(1)}))
        .await?
        .assert_failure();
    h.allocate(720).await?;
    h.profit(90).await?;
    h.redeem().await?;
    assert_eq!(h.accounting().await?["eligible_yield"], amount(10));
    h.donate(90).await?;
    assert_eq!(h.balance("token", "treasury").await?, 10 * UNIT);
    assert_eq!(h.accounting().await?["cash"], amount(800));
    h.save_lifecycle("loss-delay-recovery")
}

#[tokio::test]
async fn partial_supply_refunds_and_donation_failure_retry_once() -> Result<()> {
    let h = Harness::configured(false, true, false).await?;
    h.seeded().await?;
    h.controls(false, 600).await?;
    h.allocate(1000).await?;
    assert_eq!(h.accounting().await?["cash"], amount(400));
    assert_eq!(h.accounting().await?["strategy_book"], amount(600));
    assert_eq!(h.balance("token", "vault").await?, 400 * UNIT);
    assert_eq!(h.position("alice").await?["nominal"], amount(1000));
    h.advance("1").await?.assert_failure();
    h.profit(30).await?;
    h.redeem().await?;
    h.call(
        "treasury",
        "token",
        "storage_unregister",
        json!({"force":false}),
        1,
    )
    .await?
    .assert_success();
    h.donate(30).await?;
    assert_eq!(h.operation("3").await?["stage"], "retryable_failure");
    assert_eq!(h.accounting().await?["cash"], amount(1030));
    assert_eq!(h.accounting().await?["eligible_yield"], amount(30));
    h.register_token("token", "treasury").await?;
    h.advance("3").await?.assert_success();
    h.advance("3").await?.assert_failure();
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    assert_eq!(h.accounting().await?["donated"], amount(30));
    h.save_lifecycle("partial-supply-donation-retry")
}

#[tokio::test]
async fn donation_sent_but_callback_interrupted_never_replays() -> Result<()> {
    let h = Harness::configured(true, true, false).await?;
    h.seeded().await?;
    h.allocate(1000).await?;
    h.profit(30).await?;
    h.redeem().await?;
    h.call("guardian", "vault", "test_interrupt_callback", json!({}), 0)
        .await?
        .assert_success();
    h.operator("distribute_yield", json!({"max_amount":amount(30)}))
        .await?
        .assert_failure();
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    assert_eq!(h.accounting().await?["cash"], amount(1000));
    assert_eq!(h.accounting().await?["reserved_outbound"], amount(30));
    assert_eq!(h.accounting().await?["donated"], "0");
    assert_eq!(h.operation("3").await?["stage"], "transfer_pending");
    h.advance("3").await?.assert_failure();
    h.operator("distribute_yield", json!({"max_amount":amount(30)}))
        .await?
        .assert_failure();
    assert_eq!(
        h.deposit("token", "alice", 10, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.save_lifecycle("donation-interrupted-callback")
}

#[tokio::test]
async fn zero_supply_full_loss_authentication_and_production_controls() -> Result<()> {
    let h = Harness::configured(false, true, false).await?;
    h.seeded().await?;
    h.controls(false, 0).await?;
    h.allocate(1000).await?;
    assert_eq!(h.accounting().await?["cash"], amount(1000));
    assert_eq!(h.balance("token", "strategy").await?, 0);
    h.controls(false, 10000).await?;
    let costs = h.view("vault", "storage_costs", json!({})).await?;
    let fee = costs["operation"].as_str().unwrap().parse()?;
    h.call(
        "alice",
        "vault",
        "allocate_idle",
        json!({"amount":amount(1000)}),
        fee,
    )
    .await?
    .assert_failure();
    h.call(
        "alice",
        "strategy",
        "set_controls",
        json!({"frozen":true,"supply_limit":"0"}),
        1,
    )
    .await?
    .assert_failure();
    h.call(
        "alice",
        "strategy",
        "realize_loss",
        json!({"amount":amount(1)}),
        1,
    )
    .await?
    .assert_failure();
    h.call(
        "alice",
        "strategy",
        "redeem_all",
        json!({"operation_id":"1"}),
        1,
    )
    .await?
    .assert_failure();
    for method in ["on_allocation", "on_redemption", "on_donation"] {
        h.call(
            "alice",
            "vault",
            method,
            json!({"operation_id":"1","version":"1"}),
            0,
        )
        .await?
        .assert_failure();
    }
    assert_eq!(
        h.call(
            "alice",
            "token",
            "ft_transfer_call",
            json!({"receiver_id":"vault.test","amount":amount(10),"msg":"strategy_return:1"}),
            1
        )
        .await?
        .json::<String>()?,
        "0"
    );
    h.allocate(1000).await?;
    h.call(
        "guardian",
        "strategy",
        "realize_loss",
        json!({"amount":amount(1000)}),
        1,
    )
    .await?
    .assert_success();
    h.redeem().await?;
    assert_eq!(h.balance("token", "sink").await?, 1000 * UNIT);
    assert_eq!(h.accounting().await?["shortfall"], amount(1000));
    let exit = h.request_min(1000, 0).await?;
    h.advance(&exit).await?.assert_success();
    assert_eq!(h.operation(&exit).await?["stage"], "completed");
    assert_eq!(h.accounting().await?["nominal"], "0");
    assert_eq!(h.balance("token", "alice").await?, 1000 * UNIT);
    // Deploy the normal artifact to a separate account; no simulator controls exist.
    Contract::deploy("fake.test".parse()?)
        .use_code(std::fs::read(
            root().join("artifacts/yieldfund_strategy_simulator.wasm"),
        )?)
        .without_init_call()
        .with_signer(h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();
    h.call(
        "guardian",
        "fake",
        "set_controls",
        json!({"frozen":true,"supply_limit":"0"}),
        1,
    )
    .await?
    .assert_failure();
    h.call("guardian", "fake", "realize_loss", json!({"amount":"1"}), 1)
        .await?
        .assert_failure();
    h.save_lifecycle("zero-supply-total-loss-auth")
}

#[tokio::test]
async fn approved_dao_transfer_failure_is_not_paid_and_can_finalize_once() -> Result<()> {
    let h = Harness::configured(false, true, true).await?;
    h.seeded().await?;
    h.allocate(1000).await?;
    h.profit(30).await?;
    h.redeem().await?;
    h.donate(30).await?;
    h.call(
        "recipient",
        "token",
        "storage_unregister",
        json!({"force":false}),
        1,
    )
    .await?
    .assert_success();
    let policy = h.view("treasury", "get_policy", json!({})).await?;
    let kind = json!({"Transfer":{"token_id":"token.test","receiver_id":"recipient.test","amount":amount(20),"msg":null}});
    let id = h
        .call(
            "member1",
            "treasury",
            "add_proposal",
            json!({"proposal":{"description":"Receipt-checked payment","kind":kind}}),
            policy["proposal_bond"].as_str().unwrap().parse()?,
        )
        .await?
        .json::<u64>()?;
    let vote = json!({"id":id,"action":"VoteApprove","proposal":kind});
    h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_success();
    let failed = h
        .call("member2", "treasury", "act_proposal", vote, 0)
        .await?;
    assert!(failed.outcomes().iter().any(|o| !o.is_success()));
    assert_eq!(
        h.view("treasury", "get_proposal", json!({"id":id})).await?["status"],
        "Failed"
    );
    assert_eq!(h.balance("token", "recipient").await?, 0);
    assert_eq!(h.balance("token", "treasury").await?, 30 * UNIT);
    h.register_token("token", "recipient").await?;
    let finalize = json!({"id":id,"action":"Finalize","proposal":kind});
    h.call("member3", "treasury", "act_proposal", finalize.clone(), 0)
        .await?
        .assert_success();
    assert_eq!(h.balance("token", "recipient").await?, 20 * UNIT);
    assert_eq!(
        h.view("treasury", "get_proposal", json!({"id":id})).await?["status"],
        "Approved"
    );
    h.call("member3", "treasury", "act_proposal", finalize, 0)
        .await?
        .assert_failure();
    assert_eq!(h.balance("token", "recipient").await?, 20 * UNIT);
    h.save_lifecycle("dao-failed-payment-retry")
}

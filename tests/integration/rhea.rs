//! Actual mainnet Rhea code (read-only download) and standard NEP-141 on local Sandbox.
//! No strategy simulator, no custom token receipt methods, no public spending.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

async fn dao_call(h: &Harness, method: &str, args: Value, deposit: u128, gas: u64) -> Result<()> {
    let policy = h.view("treasury", "get_policy", json!({})).await?;
    let kind = json!({"FunctionCall":{"receiver_id":"vault.test", "actions":[{
        "method_name":method, "args":STANDARD.encode(serde_json::to_vec(&args)?),
        "deposit":deposit.to_string(), "gas":(gas * 1_000_000_000_000).to_string()
    }]}});
    let id = h
        .call(
            "member1",
            "treasury",
            "add_proposal",
            json!({"proposal":{
                "description":format!("YieldFund {method}"), "kind":kind
            }}),
            policy["proposal_bond"].as_str().unwrap().parse()?,
        )
        .await?
        .json::<u64>()?;
    let vote = json!({"id":id,"action":"VoteApprove", "proposal":kind});
    h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_success();
    let executed = h
        .call("member2", "treasury", "act_proposal", vote, 0)
        .await?;
    assert!(
        executed.outcomes().iter().all(|o| o.is_success()),
        "nested DAO execution failed: {method}"
    );
    executed.assert_success();
    assert_eq!(
        h.view("treasury", "get_proposal", json!({"id":id})).await?["status"],
        "Approved"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires pinned Rhea artifacts; scripts/test-rhea.sh runs this explicitly"]
async fn actual_rhea_supply_redemption_and_standard_token_exit() -> Result<()> {
    run_lifecycle(false).await
}
#[tokio::test]
#[ignore = "requires pinned Rhea artifacts; scripts/test-rhea.sh runs this explicitly"]
async fn actual_rhea_borrower_interest_donation_and_dao_payment() -> Result<()> {
    run_lifecycle(true).await
}
async fn run_lifecycle(with_interest: bool) -> Result<()> {
    let h = Harness::configured_engine(false, true, with_interest, true).await?;
    h.call("strategy", "strategy", "new", json!({"config": {
        "oracle_account_id":"guardian.test", "pyth_oracle_account_id":"guardian.test",
        "ref_exchange_id":"fake.test", "owner_id":"guardian.test", "booster_token_id":"token.test",
        "booster_decimals":6, "max_num_assets":16, "maximum_recency_duration_sec":60,
        "maximum_staleness_duration_sec":120, "lp_tokens_info_valid_duration_sec":60,
        "pyth_price_valid_duration_sec":60, "minimum_staking_duration_sec":1,
        "maximum_staking_duration_sec":3600, "x_booster_multiplier_at_maximum_staking_duration":10000,
        "force_closing_enabled":false, "enable_price_oracle":true, "enable_pyth_oracle":false,
        "boost_suppress_factor":1, "dcl_id":"fake.test", "contract_mode":"Running", "pause_operator_id":null
    }}), 0).await?.assert_success();
    h.call("guardian", "strategy", "add_asset", json!({"token_id":"token.test", "asset_config": {
        "reserve_ratio":2500, "beneficiaries":{}, "target_utilization":8000,
        "target_utilization_rate":"1000000000003593629036885046",
        "max_utilization_rate":"1000000000039724853136740579",
        "holding_position_fee_rate":"1000000000000000000000000000",
        "volatility_ratio":7500, "extra_decimals":0, "can_deposit":true, "can_withdraw":true,
        "can_use_as_collateral":true, "can_borrow":true, "net_tvl_multiplier":0,
        "max_change_rate":null, "supplied_limit":"1000000000000", "borrowed_limit":"500000000000", "min_borrowed_amount":"1"
    }}), 1).await?.assert_success();
    h.call(
        "guardian",
        "strategy",
        "storage_deposit",
        json!({"account_id":"vault.test"}),
        NearToken::from_near(1).as_yoctonear(),
    )
    .await?
    .assert_success();
    h.register("alice").await?;
    h.fund("token", "alice", 1000).await?;
    h.deposit("token", "alice", 1000, "deposit")
        .await?
        .assert_success();
    let cost: u128 = h.view("vault", "storage_costs", json!({})).await?["operation"]
        .as_str()
        .unwrap()
        .parse()?;
    if with_interest {
        dao_call(
            &h,
            "allocate_idle",
            json!({"amount":amount(1000)}),
            cost,
            180,
        )
        .await?;
    } else {
        h.call(
            "guardian",
            "vault",
            "allocate_idle",
            json!({"amount":amount(1000)}),
            cost,
        )
        .await?
        .assert_success();
    }
    let position = h
        .view(
            "strategy",
            "get_account_all_positions",
            json!({"account_id":"vault.test"}),
        )
        .await?;
    assert_eq!(position["supplied"][0]["balance"], amount(1000));
    assert!(position["positions"].as_object().unwrap().is_empty());
    assert_eq!(h.balance("token", "vault").await?, 0);
    assert_eq!(h.accounting().await?["mode"], "rhea_lending");
    if with_interest {
        // Local oracle fixture and an independent borrower create protocol interest.
        // No controller profit injection, rate override or direct gift is counted.
        h.call(
            "guardian",
            "strategy",
            "storage_deposit",
            json!({"account_id":"bob.test"}),
            NearToken::from_near(1).as_yoctonear(),
        )
        .await?
        .assert_success();
        h.fund("token", "bob", 1000).await?;
        h.call(
            "bob",
            "token",
            "ft_transfer_call",
            json!({"receiver_id":"strategy.test", "amount":amount(1000), "msg":""}),
            1,
        )
        .await?
        .assert_success();
        let block = near_api::Chain::block().fetch_from(&h.network).await?;
        h.call("guardian", "strategy", "oracle_on_call", json!({
            "sender_id":"bob.test", "data":{"timestamp":block.header.timestamp.to_string(), "recency_duration_sec":60,
                "prices":[{"asset_id":"token.test", "price":{"multiplier":"10000", "decimals":10}}]},
            "msg":json!({"Execute":{"actions":[
                {"IncreaseCollateral":{"token_id":"token.test", "amount":amount(1000)}},
                {"Borrow":{"token_id":"token.test", "amount":amount(500)}},
                {"Withdraw":{"token_id":"token.test", "amount":amount(500)}}
            ]}}).to_string()
        }), 0).await?.assert_success();
        assert_eq!(h.balance("token", "bob").await?, 500 * UNIT);
        h._sandbox.fast_forward(200).await?;
    }
    // An unrelated gift must not become donated yield after protocol withdrawal.
    h.fund("token", "vault", 7).await?;
    if with_interest {
        dao_call(&h, "redeem_strategy", json!({}), cost, 260).await?;
    } else {
        h.call("alice", "vault", "redeem_strategy", json!({}), cost)
            .await?
            .assert_success();
    }
    let state = h.accounting().await?;
    let returned: u128 = state["cash"].as_str().unwrap().parse()?;
    if with_interest {
        assert!(
            returned > 1000 * UNIT,
            "Rhea must return actual accrued interest"
        );
    } else {
        assert_eq!(returned, 1000 * UNIT);
    }
    assert_eq!(state["eligible_yield"], "0");
    let id = state["active_operation"].as_str().unwrap();
    for _ in 0..8 {
        let op = h.operation(id).await?;
        if op["stage"] == "completed" {
            break;
        }
        if with_interest {
            dao_call(
                &h,
                "continue_rhea_redemption",
                json!({"operation_id":id, "version":op["version"]}),
                1,
                260,
            )
            .await?;
        } else {
            h.call(
                "alice",
                "vault",
                "continue_rhea_redemption",
                json!({"operation_id":id, "version":op["version"]}),
                1,
            )
            .await?
            .assert_success();
        }
    }
    assert_eq!(h.accounting().await?["strategy_book"], "0");
    if with_interest {
        dao_call(&h, "request_checkpoint", json!({}), cost, 120).await?;
    } else {
        h.checkpoint().await?;
    }
    assert_eq!(h.accounting().await?["excluded"], amount(7));
    let earned: u128 = h.accounting().await?["eligible_yield"]
        .as_str()
        .unwrap()
        .parse()?;
    if with_interest {
        assert!(
            earned > 0 && earned < UNIT,
            "Expected small protocol accrual, not a gift"
        );
        dao_call(
            &h,
            "distribute_yield",
            json!({"max_amount":earned.to_string()}),
            cost,
            150,
        )
        .await?;
        assert_eq!(h.balance("token", "treasury").await?, earned);
        let policy = h.view("treasury", "get_policy", json!({})).await?;
        let kind = json!({"Transfer":{"token_id":"token.test", "receiver_id":"recipient.test", "amount":earned.to_string(), "msg":null}});
        let proposal_id = h
            .call(
                "member1",
                "treasury",
                "add_proposal",
                json!({"proposal":{"description":"Pay realized Rhea interest", "kind":kind}}),
                policy["proposal_bond"].as_str().unwrap().parse()?,
            )
            .await?
            .json::<u64>()?;
        let vote = json!({"id":proposal_id, "action":"VoteApprove", "proposal":kind});
        h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
            .await?
            .assert_success();
        assert_eq!(h.balance("token", "recipient").await?, 0);
        h.call("member2", "treasury", "act_proposal", vote, 0)
            .await?
            .assert_success();
        assert_eq!(h.balance("token", "recipient").await?, earned);
    } else {
        assert_eq!(earned, 0);
    }
    let withdrawal = h.request("alice", 1000).await?;
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":withdrawal}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.operation(&withdrawal).await?["stage"], "completed");
    assert_eq!(h.balance("token", "alice").await?, 1000 * UNIT);
    assert_eq!(h.balance("token", "vault").await?, 7 * UNIT);
    h.save(if with_interest {
        "rhea-interest-dao-lifecycle"
    } else {
        "rhea-standard-token-lifecycle"
    })?;
    Ok(())
}

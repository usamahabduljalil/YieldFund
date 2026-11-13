//! Factory-created, keyless accounts and real Sputnik function-call voting.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

#[tokio::test]
async fn permissionless_campaigns_and_dao_verification() -> Result<()> {
    let h = Harness::new(false).await?;
    for (name, wasm) in [
        ("factory", "yieldfund_campaign_factory.wasm"),
        ("verification", "sputnikdao2.wasm"),
    ] {
        h._sandbox
            .create_account(format!("{name}.test").parse()?)
            .initial_balance(NearToken::from_near(30))
            .send()
            .await?;
        Contract::deploy(format!("{name}.test").parse()?)
            .use_code(std::fs::read(root().join("artifacts").join(wasm))?)
            .without_init_call()
            .with_signer(h.signer.clone())
            .send_to(&h.network)
            .await?
            .assert_success();
    }
    h.call("verification", "verification", "new", json!({"config": {
        "name":"Campaign verification", "purpose":"Review metadata", "metadata":""
    }, "policy": {
        "roles":[{"name":"council","kind":{"Group":["member1.test","member2.test","member3.test"]},
            "permissions":["call:AddProposal","call:VoteApprove","call:VoteReject","call:Finalize"],"vote_policy":{}}],
        "default_vote_policy":{"weight_kind":"RoleWeight","quorum":"2","threshold":"2"},
        "proposal_bond":"100000000000000000000000","proposal_period":"604800000000000",
        "bounty_bond":"0","bounty_forgiveness_period":"86400000000000"
    }}), 0).await?.assert_success();
    h.call(
        "factory",
        "factory",
        "new",
        json!({"verifier_id":"verification.test",
        "token_id":"token.test","token_decimals":6,"token_storage":"1250000000000000000000"}),
        0,
    )
    .await?
    .assert_success();
    let cost: u128 = h
        .view("factory", "creation_cost", json!({}))
        .await?
        .as_str()
        .unwrap()
        .parse()?;
    for (actor, id, tokens) in [("alice", "alpha", 100), ("bob", "beta", 200)] {
        let args = json!({"id":id,"name":format!("Community {id}"),"beneficiary_id":"treasury.test",
            "metadata_hash":"a".repeat(64),"deposit_cap":amount(1000)});
        h.call(actor, "factory", "create_campaign", args.clone(), cost - 1)
            .await?
            .assert_failure();
        h.call(actor, "factory", "create_campaign", args.clone(), cost)
            .await?
            .assert_success();
        let c = h.view("factory", "get_campaign", json!({"id":id})).await?;
        assert_eq!(c["status"], "ready");
        assert_eq!(c["creator_id"], format!("{actor}.test"));
        assert!(c["verification"].is_null());
        let vault = format!("v-{id}.factory");
        let strategy = format!("s-{id}.factory");
        for child in [&vault, &strategy] {
            let keys = browser_fixture::rpc(
                &h._sandbox.rpc_addr,
                "query",
                json!({
                    "request_type":"view_access_key_list","finality":"final","account_id":format!("{child}.test")
                }),
            )?;
            assert!(keys["keys"].as_array().unwrap().is_empty());
        }
        assert_eq!(
            h.view(&vault, "get_config", json!({})).await?["guardian_id"],
            format!("{actor}.test")
        );
        let storage = h.view(&vault, "storage_costs", json!({})).await?["position"]
            .as_str()
            .unwrap()
            .parse()?;
        h.call(actor, &vault, "storage_deposit", json!({}), storage)
            .await?
            .assert_success();
        h.fund("token", actor, tokens).await?;
        assert_eq!(
            h.call(
                actor,
                "token",
                "ft_transfer_call",
                json!({"receiver_id":format!("{vault}.test"),
            "amount":amount(tokens),"msg":"deposit"}),
                1
            )
            .await?
            .json::<String>()?,
            amount(tokens)
        );
        h.call(actor, "factory", "create_campaign", args, cost)
            .await?
            .assert_failure();
    }
    assert_eq!(
        h.view("v-alpha.factory", "get_accounting", json!({}))
            .await?["nominal"],
        amount(100)
    );
    assert_eq!(
        h.view("v-beta.factory", "get_accounting", json!({}))
            .await?["nominal"],
        amount(200)
    );
    assert_eq!(
        h.view(
            "factory",
            "list_campaigns",
            json!({"from_index":"1","limit":1})
        )
        .await?[0]["id"],
        "beta"
    );
    let attestation = json!({"id":"alpha","metadata_hash":"a".repeat(64),"evidence_hash":"b".repeat(64),
        "expires_at":u64::MAX.to_string()});
    h.call(
        "alice",
        "factory",
        "verify_campaign",
        attestation.clone(),
        1,
    )
    .await?
    .assert_failure();
    h.call(
        "member1",
        "factory",
        "verify_campaign",
        attestation.clone(),
        1,
    )
    .await?
    .assert_failure();
    let kind = json!({"FunctionCall":{"receiver_id":"factory.test","actions":[{
        "method_name":"verify_campaign","args":STANDARD.encode(serde_json::to_vec(&attestation)?),
        "deposit":"1","gas":"30000000000000"}]}});
    let proposal_id = h
        .call(
            "member1",
            "verification",
            "add_proposal",
            json!({"proposal":{
                "description":"Approve immutable alpha metadata", "kind":kind
            }}),
            NearToken::from_millinear(100).as_yoctonear(),
        )
        .await?
        .json::<u64>()?;
    let vote = json!({"id":proposal_id,"action":"VoteApprove","proposal":kind});
    h.call("member1", "verification", "act_proposal", vote.clone(), 0)
        .await?
        .assert_success();
    assert_eq!(
        h.view("factory", "is_verified", json!({"id":"alpha"}))
            .await?,
        false
    );
    h.call("member2", "verification", "act_proposal", vote, 0)
        .await?
        .assert_success();
    assert_eq!(
        h.view("verification", "get_proposal", json!({"id":proposal_id}))
            .await?["status"],
        "Approved"
    );
    assert_eq!(
        h.view("factory", "is_verified", json!({"id":"alpha"}))
            .await?,
        true
    );
    assert_eq!(
        h.view("factory", "is_verified", json!({"id":"beta"}))
            .await?,
        false
    );
    let output = root().join("docs/evidence/campaign-factory-sandbox.json");
    std::fs::write(
        output,
        serde_json::to_vec_pretty(&json!({
            "network":"ephemeral local sandbox", "sandbox_version":"2.14.0", "public_network":false,
            "test":"permissionless_campaigns_and_dao_verification", "creation_cost":cost.to_string(),
            "transactions":h.evidence.borrow().as_slice()
        }))?,
    )?;
    Ok(())
}

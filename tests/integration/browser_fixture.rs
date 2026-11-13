//! Explicit, ignored local fixture. No secret key is written to the frontend or manifest.
use super::*;

pub(super) fn rpc(url: &str, method: &str, params: Value) -> Result<Value> {
    let output = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--fail",
            "--max-time",
            "20",
            "-H",
            "Content-Type: application/json",
            "--data",
            &json!({"jsonrpc":"2.0","id":"fixture","method":method,"params":params}).to_string(),
            url,
        ])
        .output()?;
    anyhow::ensure!(output.status.success(), "fixture RPC failed");
    let body: Value = serde_json::from_slice(&output.stdout)?;
    anyhow::ensure!(body.get("error").is_none(), "RPC error: {body}");
    Ok(body["result"].clone())
}

#[tokio::test]
#[ignore = "Run explicitly to serve a read-only local browser fixture; stop with artifacts/stop-browser-fixture"]
async fn serve_browser_fixture() -> Result<()> {
    let recovery_demo = std::env::var("YIELDFUND_BROWSER_RECOVERY").as_deref() == Ok("1");
    let h = Harness::configured(recovery_demo, true, true).await?;
    h.register("alice").await?;
    h.fund("token", "alice", 2000).await?;
    let deposit = h.deposit("token", "alice", 1000, "deposit").await?;
    let mut samples = vec![];
    let hash = deposit.outcomes()[0].transaction_hash.to_string();
    let tx = rpc(
        &h._sandbox.rpc_addr,
        "tx",
        json!({"tx_hash":hash,"sender_account_id":"alice.test","wait_until":"FINAL"}),
    )?;
    samples.push(json!({"hash":hash,"actor":"alice.test","call":{"receiverId":"token.test","methodName":"ft_transfer_call","args":{"receiver_id":"vault.test","amount":amount(1000),"msg":"deposit"},"deposit":"1","gas":"300000000000000"},"transaction":tx}));
    let costs = h.view("vault", "storage_costs", json!({})).await?;
    let fee = costs["operation"].as_str().unwrap().parse()?;
    h.call(
        "guardian",
        "vault",
        "allocate_idle",
        json!({"amount":amount(1000)}),
        fee,
    )
    .await?
    .assert_success();
    h.call(
        "guardian",
        "token",
        "ft_transfer_call",
        json!({"receiver_id":"strategy.test","amount":amount(30),"msg":"fund_profit"}),
        1,
    )
    .await?
    .assert_success();
    h.call("guardian", "vault", "redeem_strategy", json!({}), fee)
        .await?
        .assert_success();
    h.call(
        "guardian",
        "vault",
        "distribute_yield",
        json!({"max_amount":amount(30)}),
        fee,
    )
    .await?
    .assert_success();
    let policy = h.view("treasury", "get_policy", json!({})).await?;
    let kind = json!({"Transfer":{"token_id":"token.test","receiver_id":"recipient.test","amount":amount(20),"msg":null}});
    h.call(
        "member1",
        "treasury",
        "add_proposal",
        json!({"proposal":{"description":"Commons maintenance","kind":kind}}),
        policy["proposal_bond"].as_str().unwrap().parse()?,
    )
    .await?
    .assert_success();
    let vote = json!({"id":0,"action":"VoteApprove","proposal":kind});
    h.call("member1", "treasury", "act_proposal", vote.clone(), 0)
        .await?
        .assert_success();
    let paid = h
        .call("member2", "treasury", "act_proposal", vote.clone(), 0)
        .await?;
    let hash = paid.outcomes()[0].transaction_hash.to_string();
    let tx = rpc(
        &h._sandbox.rpc_addr,
        "tx",
        json!({"tx_hash":hash,"sender_account_id":"member2.test","wait_until":"FINAL"}),
    )?;
    samples.push(json!({"hash":hash,"actor":"member2.test","call":{"receiverId":"treasury.test","methodName":"act_proposal","args":vote,"deposit":"0","gas":"300000000000000"},"transaction":tx}));
    if recovery_demo {
        h.call(
            "guardian",
            "vault",
            "test_set_read_fault",
            json!({"stage":"balance","enabled":true}),
            0,
        )
        .await?
        .assert_success();
        h.call("guardian", "vault", "request_checkpoint", json!({}), fee)
            .await?
            .assert_failure();
        h.call(
            "guardian",
            "vault",
            "test_set_read_fault",
            json!({"stage":"balance","enabled":false}),
            0,
        )
        .await?
        .assert_success();
    }
    let status = rpc(&h._sandbox.rpc_addr, "status", json!({}))?;
    let mut hashes = serde_json::Map::new();
    for (name, file) in [
        (
            "vault",
            if recovery_demo {
                "yieldfund_vault_faults.wasm"
            } else {
                "yieldfund_vault.wasm"
            },
        ),
        ("token", "yieldfund_test_token.wasm"),
        ("strategy", "yieldfund_strategy_simulator_controls.wasm"),
        ("treasury", "sputnikdao2.wasm"),
    ] {
        let output = std::process::Command::new("sha256sum")
            .arg(root().join("artifacts").join(file))
            .output()?;
        anyhow::ensure!(output.status.success(), "hash failed");
        hashes.insert(
            format!("{name}.test"),
            json!(String::from_utf8(output.stdout)?
                .split_whitespace()
                .next()
                .unwrap()),
        );
    }
    let manifest = json!({"mode":"chain","network":"sandbox","chainId":status["chain_id"],"rpcUrl":h._sandbox.rpc_addr,"vaultId":"vault.test",
      "config":h.view("vault","get_config",json!({})).await?,"codeHashes":hashes,"daoPolicy":policy,
      "factoryInfo":h.view("treasury","get_factory_info",json!({})).await?,"transactionsEnabled":false,
      "authority":if recovery_demo { "Ephemeral local recovery fixture. Full-access test keys retained; vault faults and simulator controls enabled. No public funds." } else { "Ephemeral local fixture. Full-access test keys retained; simulator controls enabled. No public funds." }});
    std::fs::write(
        root().join("artifacts/browser-deployment.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    std::fs::write(
        root().join("apps/web/public/deployment.local.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    std::fs::write(
        root().join("artifacts/browser-receipts.json"),
        serde_json::to_vec_pretty(&samples)?,
    )?;
    println!("READ-ONLY BROWSER FIXTURE READY: {}", h._sandbox.rpc_addr);
    while !root().join("artifacts/stop-browser-fixture").exists() {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Ok(())
}

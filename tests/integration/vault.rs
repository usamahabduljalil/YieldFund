//! Real Wasm + NEP-141 receipts on a fresh, loopback-only Sandbox. No public network.
use anyhow::{Context, Result};
use near_api::types::transaction::result::ExecutionFinalResult;
use near_api::{Contract, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::Sandbox;
use serde_json::{json, Value};
use std::{cell::RefCell, path::PathBuf, sync::Arc};

const UNIT: u128 = 1_000_000;
mod browser_fixture;
mod campaigns;
mod lifecycle;
mod recovery;
mod rhea;
fn amount(tokens: u128) -> String {
    (tokens * UNIT).to_string()
}
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn evidence_dir() -> PathBuf {
    root().join(
        std::env::var("YIELDFUND_EVIDENCE_DIR")
            .unwrap_or_else(|_| "docs/evidence/milestone-5-receipts".into()),
    )
}

struct Harness {
    _sandbox: Sandbox,
    network: NetworkConfig,
    signer: Arc<Signer>,
    evidence: RefCell<Vec<Value>>,
}

impl Harness {
    async fn new(faults: bool) -> Result<Self> {
        Self::configured(faults, false, false).await
    }
    async fn configured(faults: bool, strategy: bool, dao: bool) -> Result<Self> {
        Self::configured_engine(faults, strategy, dao, false).await
    }
    async fn configured_engine(
        faults: bool,
        strategy: bool,
        dao: bool,
        rhea: bool,
    ) -> Result<Self> {
        let sandbox = Sandbox::start_sandbox_with_version("2.14.0").await?;
        assert!(
            sandbox.rpc_addr.starts_with("http://127.0.0.1:"),
            "test must use loopback Sandbox"
        );
        let network = NetworkConfig::from_rpc_url("yieldfund-sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        for name in [
            "guardian",
            "alice",
            "bob",
            "vault",
            "token",
            "fake",
            "treasury",
            "strategy",
            "sink",
            "member1",
            "member2",
            "member3",
            "recipient",
        ] {
            sandbox
                .create_account(format!("{name}.test").parse()?)
                .initial_balance(NearToken::from_near(30))
                .send()
                .await?;
        }
        let h = Self {
            _sandbox: sandbox,
            network,
            signer,
            evidence: RefCell::new(vec![]),
        };
        for (name, file) in [
            (
                "token",
                if rhea {
                    "integration-sources/rhea-lending/releases/fungible_token.wasm"
                } else {
                    "yieldfund_test_token.wasm"
                },
            ),
            ("fake", "yieldfund_test_token.wasm"),
            (
                "vault",
                if rhea {
                    "rhea/yieldfund_rhea_vault.wasm"
                } else if faults {
                    "yieldfund_vault_faults.wasm"
                } else {
                    "yieldfund_vault.wasm"
                },
            ),
        ] {
            let wasm = std::fs::read(root().join("artifacts").join(file))
                .context("run scripts/build-contracts.sh --with-test-faults first")?;
            Contract::deploy(format!("{name}.test").parse()?)
                .use_code(wasm)
                .without_init_call()
                .with_signer(h.signer.clone())
                .send_to(&h.network)
                .await?
                .assert_success();
        }
        for (enabled, name, file) in [
            (
                strategy,
                "strategy",
                if rhea {
                    "rhea/mainnet-rhea.wasm"
                } else {
                    "yieldfund_strategy_simulator_controls.wasm"
                },
            ),
            (dao, "treasury", "sputnikdao2.wasm"),
        ] {
            if enabled {
                Contract::deploy(format!("{name}.test").parse()?)
                    .use_code(std::fs::read(root().join("artifacts").join(file))?)
                    .without_init_call()
                    .with_signer(h.signer.clone())
                    .send_to(&h.network)
                    .await?
                    .assert_success();
            }
        }
        for token in ["token", "fake"] {
            let initialized = h
                .call(
                    "guardian",
                    token,
                    "new",
                    json!({"owner_id":"guardian.test", "total_supply":amount(1_000_000),
                        "metadata":{"spec":"ft-1.0.0", "name":"Sandbox token", "symbol":"LOCAL", "decimals":6}}),
                    0,
                )
                .await?;
            if !rhea || token != "token" {
                assert!(initialized
                    .logs()
                    .iter()
                    .any(|log| log.contains("\"event\":\"ft_mint\"")));
            }
            initialized.assert_success();
            assert_eq!(
                h.view(token, "ft_total_supply", json!({})).await?,
                amount(1_000_000)
            );
            for name in [
                "alice",
                "bob",
                "vault",
                "treasury",
                "strategy",
                "sink",
                "recipient",
            ] {
                h.register_token(token, name).await?;
            }
        }
        h.call("vault", "vault", "new", json!({"config":{
            "campaign_id":"commons", "token_id":"token.test", "token_decimals":6,
            "beneficiary_id":"treasury.test", "guardian_id": if rhea && dao { "treasury.test" } else { "guardian.test" }, "deposit_cap":amount(10_000),
            "metadata_hash":"sandbox-fixture", "disclosure_version":"1.0",
            "strategy_id": if strategy { Some("strategy.test") } else { None }, "rhea_extra_decimals":0
        }}), 0).await?.assert_success();
        if strategy && !rhea {
            h.call("strategy", "strategy", "new", json!({"token_id":"token.test", "vault_id":"vault.test", "controller_id":"guardian.test", "loss_sink_id":"sink.test"}), 0).await?.assert_success();
        }
        if dao {
            h.call("treasury", "treasury", "new", json!({"config":{"name":"YieldFund Sandbox DAO","purpose":"Fictional commons","metadata":""},"policy":{
                "roles":[{"name":"council", "kind":{"Group":["member1.test","member2.test","member3.test"]},"permissions":if rhea { vec!["transfer:AddProposal","transfer:VoteApprove","transfer:VoteReject","transfer:Finalize", "call:AddProposal", "call:VoteApprove", "call:VoteReject", "call:Finalize"] } else { vec!["transfer:AddProposal","transfer:VoteApprove","transfer:VoteReject","transfer:Finalize"] },"vote_policy":{}}],
                "default_vote_policy":{"weight_kind":"RoleWeight","quorum":"2","threshold":"2"},
                "proposal_bond":NearToken::from_millinear(100).as_yoctonear().to_string(),
                "proposal_period":"604800000000000", "bounty_bond":"0", "bounty_forgiveness_period":"86400000000000"
            }}), 0).await?.assert_success();
        }
        Ok(h)
    }
    async fn call(
        &self,
        actor: &str,
        contract: &str,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> Result<ExecutionFinalResult> {
        let result = Contract(format!("{contract}.test").parse()?)
            .call_function(method, args.clone())
            .transaction()
            .gas(NearGas::from_tgas(300))
            .deposit(NearToken::from_yoctonear(deposit))
            .with_signer(format!("{actor}.test").parse()?, self.signer.clone())
            .send_to(&self.network)
            .await?
            .into_full()
            .context("missing finalized result")?;
        self.evidence.borrow_mut().push(json!({
            "actor":actor, "contract":contract, "method":method, "args":args,
            "success":result.is_success(), "gas_burnt":result.total_gas_burnt.as_gas().to_string(),
            "outcomes":result.outcomes().iter().map(|o| json!({
                "id":o.transaction_hash.to_string(), "executor":o.executor_id.to_string(),
                "success":o.is_success(), "generated_receipt_ids":o.receipt_ids.iter().map(ToString::to_string).collect::<Vec<_>>(),
                "logs":o.logs
            })).collect::<Vec<_>>()
        }));
        Ok(result)
    }
    async fn view(&self, contract: &str, method: &str, args: Value) -> Result<Value> {
        Ok(Contract(format!("{contract}.test").parse()?)
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data)
    }
    async fn register_token(&self, token: &str, name: &str) -> Result<()> {
        self.call(
            "guardian",
            token,
            "storage_deposit",
            json!({"account_id":format!("{name}.test"),"registration_only":true}),
            self.view(token, "storage_balance_bounds", json!({}))
                .await?["min"]
                .as_str()
                .unwrap()
                .parse()?,
        )
        .await?
        .assert_success();
        Ok(())
    }
    async fn register(&self, name: &str) -> Result<()> {
        let costs = self.view("vault", "storage_costs", json!({})).await?;
        self.call(
            name,
            "vault",
            "storage_deposit",
            json!({}),
            costs["position"].as_str().unwrap().parse()?,
        )
        .await?
        .assert_success();
        Ok(())
    }
    async fn fund(&self, token: &str, name: &str, tokens: u128) -> Result<()> {
        self.call(
            "guardian",
            token,
            "ft_transfer",
            json!({"receiver_id":format!("{name}.test"),"amount":amount(tokens)}),
            1,
        )
        .await?
        .assert_success();
        Ok(())
    }
    async fn deposit(
        &self,
        token: &str,
        name: &str,
        tokens: u128,
        msg: &str,
    ) -> Result<ExecutionFinalResult> {
        self.call(
            name,
            token,
            "ft_transfer_call",
            json!({"receiver_id":"vault.test","amount":amount(tokens),"msg":msg}),
            1,
        )
        .await
    }
    async fn balance(&self, token: &str, name: &str) -> Result<u128> {
        Ok(self
            .view(
                token,
                "ft_balance_of",
                json!({"account_id":format!("{name}.test")}),
            )
            .await?
            .as_str()
            .unwrap()
            .parse()?)
    }
    async fn position(&self, name: &str) -> Result<Value> {
        self.view(
            "vault",
            "get_position",
            json!({"account_id":format!("{name}.test")}),
        )
        .await
    }
    async fn operation(&self, id: &str) -> Result<Value> {
        self.view("vault", "get_operation", json!({"operation_id":id}))
            .await
    }
    async fn accounting(&self) -> Result<Value> {
        self.view("vault", "get_accounting", json!({})).await
    }
    async fn request(&self, name: &str, tokens: u128) -> Result<String> {
        let costs = self.view("vault", "storage_costs", json!({})).await?;
        Ok(self
            .call(
                name,
                "vault",
                "request_withdraw",
                json!({"units":amount(tokens),"min_amount":amount(tokens)}),
                costs["operation"].as_str().unwrap().parse()?,
            )
            .await?
            .json()?)
    }
    async fn checkpoint(&self) -> Result<()> {
        let costs = self.view("vault", "storage_costs", json!({})).await?;
        self.call(
            "guardian",
            "vault",
            "request_checkpoint",
            json!({}),
            costs["operation"].as_str().unwrap().parse()?,
        )
        .await?
        .assert_success();
        Ok(())
    }
    fn save(&self, name: &str) -> Result<()> {
        let dir = evidence_dir();
        std::fs::create_dir_all(&dir)?;
        std::fs::write(
            dir.join(format!("{name}.json")),
            serde_json::to_vec_pretty(&json!({
                "network":"ephemeral local sandbox", "sandbox_version":"2.14.0", "public_network":false,
                "test":name, "transactions":self.evidence.borrow().as_slice()
            }))?,
        )?;
        Ok(())
    }
}

#[tokio::test]
async fn deposits_refunds_permissions_and_healthy_exit() -> Result<()> {
    let h = Harness::new(false).await?;
    h.fund("token", "alice", 2000).await?;
    // Missing position registration: standard resolver refunds the entire transfer.
    assert_eq!(
        h.deposit("token", "alice", 1000, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    assert_eq!(h.balance("token", "alice").await?, 2000 * UNIT);
    assert_eq!(h.balance("token", "vault").await?, 0);
    assert!(h.position("alice").await?.is_null());
    h.call("alice", "vault", "storage_deposit", json!({}), 0)
        .await?
        .assert_failure();
    h.register("alice").await?;
    h.deposit("token", "alice", 1000, "deposit")
        .await?
        .assert_success();
    assert_eq!(h.position("alice").await?["nominal"], amount(1000));
    assert_eq!(h.balance("token", "vault").await?, 1000 * UNIT);
    assert_eq!(
        h.deposit("token", "alice", 10, "invalid")
            .await?
            .json::<String>()?,
        "0"
    );
    h.fund("fake", "alice", 100).await?;
    let fake_result = h.deposit("fake", "alice", 100, "deposit").await?;
    assert!(
        !fake_result.receipt_failures().is_empty(),
        "fake token hook must fail in a nested receipt"
    );
    assert_eq!(fake_result.json::<String>()?, "0");
    assert_eq!(h.balance("fake", "alice").await?, 100 * UNIT);
    assert_eq!(h.position("alice").await?["nominal"], amount(1000));
    h.call(
        "alice",
        "vault",
        "ft_on_transfer",
        json!({"sender_id":"alice.test","amount":amount(1000),"msg":"deposit"}),
        0,
    )
    .await?
    .assert_failure();
    h.call(
        "bob",
        "vault",
        "on_transfer",
        json!({"operation_id":"1","version":"1"}),
        0,
    )
    .await?
    .assert_failure();
    h.call(
        "bob",
        "vault",
        "on_balance",
        json!({"operation_id":"1","version":"1"}),
        0,
    )
    .await?
    .assert_failure();
    h.call("bob", "vault", "set_paused", json!({"paused":true}), 1)
        .await?
        .assert_failure();
    h.call("guardian", "vault", "set_paused", json!({"paused":true}), 1)
        .await?
        .assert_success();
    assert_eq!(
        h.deposit("token", "alice", 100, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    // Pause blocks deposits, but not reconciled supporter exits.
    let id = h.request("alice", 200).await?;
    assert_eq!(h.position("alice").await?["reserved"], amount(200));
    assert_eq!(h.accounting().await?["nominal"], amount(1000));
    h.call(
        "bob",
        "vault",
        "cancel_withdraw",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_failure();
    let exit = h
        .call(
            "bob",
            "vault",
            "advance_operation",
            json!({"operation_id":id}),
            1,
        )
        .await?;
    assert!(
        exit.receipt_failures().is_empty(),
        "healthy payout receipts must all succeed: {exit:?}"
    );
    exit.assert_success();
    assert_eq!(h.operation(&id).await?["stage"], "completed");
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    assert_eq!(h.balance("token", "vault").await?, 800 * UNIT);
    assert_eq!(h.position("alice").await?["nominal"], amount(800));
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_failure();
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    // No method exists to route supporter funds to the beneficiary.
    h.call(
        "guardian",
        "vault",
        "distribute_yield",
        json!({"max_amount":amount(1)}),
        1,
    )
    .await?
    .assert_failure();
    assert_eq!(h.balance("token", "treasury").await?, 0);
    // Also prove the production artifact has no fault injection export.
    h.call("guardian", "vault", "test_interrupt_callback", json!({}), 0)
        .await?
        .assert_failure();
    h.save("deposits-and-exit")
}

#[tokio::test]
async fn failed_payout_restores_reservations_and_retries_once() -> Result<()> {
    let h = Harness::new(false).await?;
    h.register("alice").await?;
    h.fund("token", "alice", 1000).await?;
    h.deposit("token", "alice", 1000, "deposit")
        .await?
        .assert_success();
    let id = h.request("alice", 200).await?;
    // Empty token balance lets Alice unregister from the token, forcing ft_transfer failure.
    h.call(
        "alice",
        "token",
        "storage_unregister",
        json!({"force":false}),
        1,
    )
    .await?
    .assert_success();
    let failed = h
        .call(
            "alice",
            "vault",
            "advance_operation",
            json!({"operation_id":id}),
            1,
        )
        .await?;
    assert!(
        failed.is_success(),
        "callback should handle failure without panicking"
    );
    assert!(
        !failed.receipt_failures().is_empty(),
        "the token payout receipt must fail"
    );
    assert_eq!(h.operation(&id).await?["stage"], "retryable_failure");
    assert_eq!(h.accounting().await?["cash"], amount(1000));
    assert_eq!(h.position("alice").await?["nominal"], amount(1000));
    assert_eq!(h.position("alice").await?["reserved"], amount(200));
    assert_eq!(h.balance("token", "vault").await?, 1000 * UNIT);
    h.register_token("token", "alice").await?;
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.balance("token", "alice").await?, 200 * UNIT);
    assert_eq!(h.position("alice").await?["withdrawn"], amount(200));
    assert_eq!(h.operation(&id).await?["stage"], "completed");
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_failure();
    assert_eq!(h.balance("token", "alice").await?, 200 * UNIT);
    let cancelled = h.request("alice", 100).await?;
    h.call(
        "alice",
        "vault",
        "cancel_withdraw",
        json!({"operation_id":cancelled}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.position("alice").await?["reserved"], "0");
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":cancelled}),
        1,
    )
    .await?
    .assert_failure();
    h.save("failed-transfer-and-retry")
}

#[tokio::test]
async fn unsolicited_tokens_are_quarantined_cap_and_final_exit_hold() -> Result<()> {
    let h = Harness::new(false).await?;
    h.register("alice").await?;
    h.fund("token", "alice", 11_000).await?;
    assert_eq!(
        h.deposit("token", "alice", 10_001, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    assert_eq!(h.balance("token", "alice").await?, 11_000 * UNIT);
    h.deposit("token", "alice", 1000, "deposit")
        .await?
        .assert_success();
    h.fund("token", "vault", 500).await?; // Direct transfer: no deposit hook, no position credit.
    h.checkpoint().await?;
    let a = h.accounting().await?;
    assert_eq!(a["cash"], amount(1000));
    assert_eq!(a["excluded"], amount(500));
    assert_eq!(a["eligible_yield"], "0");
    assert_eq!(a["nominal"], amount(1000));
    let id = h.request("alice", 1000).await?;
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_success();
    assert_eq!(h.balance("token", "alice").await?, 11_000 * UNIT);
    assert_eq!(h.balance("token", "vault").await?, 500 * UNIT);
    assert_eq!(h.accounting().await?["nominal"], "0");
    assert_eq!(h.accounting().await?["cash"], "0");
    assert_eq!(h.balance("token", "treasury").await?, 0);
    h.save("quarantine-and-final-exit")
}

#[tokio::test]
async fn successful_transfer_with_failed_callback_stays_locked_and_cannot_pay_twice() -> Result<()>
{
    let h = Harness::new(true).await?;
    h.register("alice").await?;
    h.fund("token", "alice", 2000).await?;
    h.deposit("token", "alice", 1000, "deposit")
        .await?
        .assert_success();
    h.call("guardian", "vault", "test_interrupt_callback", json!({}), 0)
        .await?
        .assert_success();
    let id = h.request("alice", 200).await?;
    let interrupted = h
        .call(
            "alice",
            "vault",
            "advance_operation",
            json!({"operation_id":id}),
            1,
        )
        .await?;
    assert!(interrupted.is_failure(), "final callback must fail");
    assert!(interrupted
        .receipt_outcomes()
        .iter()
        .any(|r| r.executor_id.as_str() == "token.test" && r.is_success()));
    assert_eq!(
        h.balance("token", "alice").await?,
        1200 * UNIT,
        "token transfer actually succeeded"
    );
    assert_eq!(h.balance("token", "vault").await?, 800 * UNIT);
    assert_eq!(h.operation(&id).await?["stage"], "transfer_pending");
    assert_eq!(h.accounting().await?["reserved_outbound"], amount(200));
    assert_eq!(h.accounting().await?["nominal"], amount(800));
    h.call(
        "alice",
        "vault",
        "advance_operation",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_failure();
    h.call(
        "alice",
        "vault",
        "cancel_withdraw",
        json!({"operation_id":id}),
        1,
    )
    .await?
    .assert_failure();
    assert_eq!(
        h.deposit("token", "alice", 100, "deposit")
            .await?
            .json::<String>()?,
        "0"
    );
    assert_eq!(h.balance("token", "alice").await?, 1200 * UNIT);
    assert_eq!(h.balance("token", "vault").await?, 800 * UNIT);
    h.save("interrupted-callback")
}

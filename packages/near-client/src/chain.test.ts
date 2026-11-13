import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ChainClient,
  inspectTransaction,
  parseDeployment,
  type Deployment,
  type Snapshot,
  type Transaction,
  type Call,
  type Operation,
} from "./chain";
import {
  prepareCall,
  restoreSubmissions,
  isWalletRejection,
  scope,
} from "./actions";

it("shares only in-flight snapshots for the same account and clears failed reads", async () => {
  let calls = 0;
  const deployment = JSON.parse(
    readFileSync("deployments/testnet.json", "utf8"),
  ) as Deployment;
  const client = new ChainClient(deployment, async () => {
    calls++;
    return new Response(
      JSON.stringify({
        result: { chain_id: "wrong-network", sync_info: { syncing: false } },
      }),
    );
  });
  const first = client.snapshot("alice.testnet");
  expect(client.snapshot("alice.testnet")).toBe(first);
  const other = client.snapshot("bob.testnet");
  expect(other).not.toBe(first);
  await Promise.all([
    expect(first).rejects.toThrow("Wrong network"),
    expect(other).rejects.toThrow("Wrong network"),
  ]);
  expect(calls).toBe(2);
  await expect(client.snapshot("alice.testnet")).rejects.toThrow(
    "Wrong network",
  );
  expect(calls).toBe(3);
});
const fixture = JSON.parse(
  readFileSync("docs/evidence/milestone-4-fixtures/deployment.json", "utf8"),
) as Deployment;
const samples = JSON.parse(
  readFileSync("docs/evidence/milestone-4-fixtures/transactions.json", "utf8"),
) as Array<{
  hash: string;
  actor: string;
  call: Call;
  transaction: Transaction;
}>;
const testnet: Deployment = {
  ...fixture,
  network: "testnet",
  chainId: "testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  transactionsEnabled: true,
};
function snapshot(): Snapshot {
  return {
    blockHash: "block",
    height: 100,
    timestamp: Date.now(),
    fetchedAt: Date.now(),
    accountId: "alice.test",
    accounting: {
      mode: "funded_simulator",
      cash: "1000000000",
      excluded: "0",
      nominal: "1000000000",
      backing: "1000000000",
      shortfall: "0",
      eligible_yield: "0",
      strategy_book: "0",
      donated: "0",
      reserved_outbound: "0",
      settled: true,
      paused: false,
      needs_reconciliation: false,
      active_operation: null,
      queued_redemption: null,
      checkpoint_at: "0",
      state_version: "1",
    },
    operations: [],
    proposals: [],
    proposalCount: 0,
    policy: fixture.daoPolicy,
    position: {
      nominal: "1000000000",
      reserved: "200000000",
      deposited: "1000000000",
      withdrawn: "0",
    },
    tokenBalance: "1000000000",
    treasuryBalance: "0",
    tokenRegistered: true,
    vaultRegistered: true,
    daoRegistered: true,
    costs: {
      position: "5120000000000000000000",
      operation: "20480000000000000000001",
    },
    tokenStorageCost: "1250000000000000000000",
    strategy: { position: "0", busy: false },
    nativeBalance: "1000000000000000000000000",
  };
}
describe("deployment gate", () => {
  it("rejects a manifest that weakens the required council threshold", () => {
    const bad = structuredClone(testnet);
    bad.daoPolicy.default_vote_policy.threshold = "1";
    expect(() => parseDeployment(bad)).toThrow("Unsupported DAO policy");
    bad.daoPolicy.default_vote_policy.threshold = "2";
    bad.daoPolicy.roles[0].vote_policy.transfer = { threshold: "1" };
    expect(() => parseDeployment(bad)).toThrow("Unsupported DAO policy");
  });
  it("accepts explicit preview and verified local/testnet shape", () => {
    expect(parseDeployment({ mode: "preview" })).toEqual({ mode: "preview" });
    expect(parseDeployment(fixture).mode).toBe("chain");
    expect(parseDeployment(testnet).mode).toBe("chain");
  });
  it("rejects mainnet, nonlocal Sandbox, missing hashes and browser Sandbox signing", () => {
    for (const d of [
      { ...testnet, network: "mainnet" },
      { ...fixture, rpcUrl: "http://evil.example" },
      { ...testnet, codeHashes: {} },
      { ...fixture, transactionsEnabled: true },
    ])
      expect(() => parseDeployment(d)).toThrow();
  });
  it("fails before reading accounts on a wrong network", async () => {
    const transport = async () =>
      new Response(
        JSON.stringify({
          result: { chain_id: "mainnet", sync_info: { syncing: false } },
        }),
      );
    await expect(
      new ChainClient(testnet, transport).snapshot(),
    ).rejects.toThrow("Wrong network");
  });
});
describe("unsigned vault actions", () => {
  it("uses exact token, receiver, gas and raw amounts without floating point", () => {
    const call = prepareCall(testnet, snapshot(), "alice.test", {
      kind: "deposit",
      amount: "900719925",
    });
    expect(call.receiverId).toBe("token.test");
    expect(call.args).toEqual({
      receiver_id: "vault.test",
      amount: "900719925",
      msg: "deposit",
    });
    expect(call.deposit).toBe("1");
  });
  it("requires storage, healthy settlement, available units and minimum consent", () => {
    const s = snapshot();
    s.position = null;
    expect(() =>
      prepareCall(testnet, s, "alice.test", { kind: "deposit", amount: "1" }),
    ).toThrow("storage");
    for (const a of [
      { settled: false },
      { paused: true },
      { shortfall: "1" },
      { active_operation: "2" },
    ])
      expect(() =>
        prepareCall(
          testnet,
          { ...snapshot(), accounting: { ...snapshot().accounting, ...a } },
          "alice.test",
          { kind: "deposit", amount: "1" },
        ),
      ).toThrow();
    expect(() =>
      prepareCall(testnet, snapshot(), "alice.test", {
        kind: "withdraw",
        amount: "900000000",
        minimum: "0",
      }),
    ).toThrow("available units");
    expect(() =>
      prepareCall(testnet, snapshot(), "alice.test", {
        kind: "withdraw",
        amount: "1",
        minimum: "2",
      }),
    ).toThrow("Minimum");
  });
  it("uses queried storage charges and rejects stale/account-changed reviews", () => {
    const s = snapshot();
    s.position = null;
    expect(
      prepareCall(testnet, s, "alice.test", { kind: "register-position" })
        .deposit,
    ).toBe(s.costs.position);
    expect(() =>
      prepareCall(testnet, s, "bob.test", { kind: "checkpoint" }),
    ).toThrow("Account changed");
    s.fetchedAt -= 60000;
    expect(() =>
      prepareCall(testnet, s, "alice.test", { kind: "register-position" }),
    ).toThrow("Refresh");
  });
  it("does not permit a supporter to allocate or donate", () => {
    for (const kind of ["allocate", "donate"] as const)
      expect(() =>
        prepareCall(testnet, snapshot(), "alice.test", { kind, amount: "1" }),
      ).toThrow("Guardian");
  });
  it("binds recovery to the active operation version and finalized cooldown", () => {
    const s = snapshot();
    s.accounting.active_operation = "7";
    const op: Operation = {
      id: "7",
      kind: "withdrawal",
      owner_id: "alice.test",
      units: "200000000",
      minimum: "180000000",
      payout: "0",
      stage: "reconciling",
      version: "22",
      started_at: "0",
      updated_at: String(BigInt(s.timestamp - 300001) * 1000000n),
      error: null,
    };
    const call = prepareCall(testnet, s, "alice.test", {
      kind: "recover",
      operation: op,
    });
    expect(call.methodName).toBe("recover_operation");
    expect(call.args).toEqual({ operation_id: "7", version: "22" });
    expect(call.deposit).toBe("1");
    expect(() =>
      prepareCall(testnet, s, "alice.test", {
        kind: "recover",
        operation: {
          ...op,
          updated_at: String(BigInt(s.timestamp) * 1000000n),
        },
      }),
    ).toThrow("five minutes");
    for (const patch of [
      { stage: "transfer_pending" },
      { kind: "allocation", stage: "needs_reconciliation" },
      { payout: "1" },
    ])
      expect(() =>
        prepareCall(testnet, s, "alice.test", {
          kind: "recover",
          operation: { ...op, ...patch },
        }),
      ).toThrow("No automatic recovery");
    s.accounting.active_operation = "8";
    expect(() =>
      prepareCall(testnet, s, "alice.test", { kind: "recover", operation: op }),
    ).toThrow("No automatic recovery");
  });
  it("recovers only the existing queued strategy redemption", () => {
    const s = snapshot();
    s.accounting.active_operation = "2";
    s.accounting.queued_redemption = "2";
    s.accounting.strategy_book = "1000000000";
    const op: Operation = {
      id: "2",
      kind: "redemption",
      owner_id: "alice.test",
      units: "1000000000",
      minimum: "0",
      payout: "1030000000",
      stage: "needs_reconciliation",
      version: "8",
      started_at: "0",
      updated_at: "0",
      error: "redemption_outcome_unknown",
    };
    expect(
      prepareCall(testnet, s, "alice.test", { kind: "recover", operation: op })
        .args,
    ).toEqual({ operation_id: "2", version: "8" });
    s.accounting.queued_redemption = "3";
    expect(() =>
      prepareCall(testnet, s, "alice.test", { kind: "recover", operation: op }),
    ).toThrow("Recovery state changed");
  });
});
describe("actual Sandbox receipt interpretation", () => {
  it("proves accepted deposits and DAO token payment from finalized nested receipts", () => {
    const deposit = inspectTransaction(
      samples[0].transaction,
      samples[0].hash,
      samples[0].actor,
      samples[0].call,
      fixture,
    );
    expect(deposit.status).toBe("finalized");
    expect(deposit.summary).toBe("Deposit accepted");
    const payment = inspectTransaction(
      samples[1].transaction,
      samples[1].hash,
      samples[1].actor,
      samples[1].call,
      fixture,
    );
    expect(payment.status).toBe("finalized");
    expect(payment.paymentConfirmed).toBe(true);
    expect(
      payment.transfers.some(
        (t) =>
          t.from === "treasury.test" &&
          t.to === "recipient.test" &&
          t.amount === "20000000",
      ),
    ).toBe(true);
  });
  it("does not trust wallet optimistic results, unrelated hashes or changed parameters", () => {
    const s = samples[0],
      tx = structuredClone(s.transaction);
    tx.final_execution_status = "EXECUTED_OPTIMISTIC";
    expect(
      inspectTransaction(tx, s.hash, s.actor, s.call, fixture).status,
    ).toBe("pending");
    expect(() =>
      inspectTransaction(tx, "other", s.actor, s.call, fixture),
    ).toThrow("identity");
    expect(() =>
      inspectTransaction(
        tx,
        s.hash,
        s.actor,
        { ...s.call, args: { ...s.call.args, amount: "1" } },
        fixture,
      ),
    ).toThrow("parameters");
  });
  it("requires a complete receipt tree and ignores forged logs from other executors", () => {
    const s = samples[1],
      tx = structuredClone(s.transaction);
    tx.receipts_outcome = [];
    expect(() =>
      inspectTransaction(tx, s.hash, s.actor, s.call, fixture),
    ).toThrow("Incomplete");
    const forged = structuredClone(s.transaction);
    for (const o of forged.receipts_outcome)
      if (o.outcome.executor_id === "token.test")
        o.outcome.executor_id = "fake.test";
    expect(
      inspectTransaction(forged, s.hash, s.actor, s.call, fixture)
        .paymentConfirmed,
    ).toBe(false);
  });
  it("treats a failed nested receipt as attention, not successful execution", () => {
    const s = samples[1],
      tx = structuredClone(s.transaction);
    tx.receipts_outcome.at(-1)!.outcome.status = {
      Failure: { error: "injected" },
    };
    expect(
      inspectTransaction(tx, s.hash, s.actor, s.call, fixture).status,
    ).toBe("attention");
  });
});
describe("refresh and cancellation", () => {
  it("rechecks stored success and keeps unknown outcomes blocked across refresh", () => {
    const row = {
      id: "one",
      scope: scope(fixture),
      accountId: "alice.test",
      call: samples[0].call,
      createdAt: Date.now(),
      minHeight: 1,
      state: "finalized",
      hash: samples[0].hash,
      operationIds: ["1"],
      receiptIds: ["receipt"],
      paymentConfirmed: true,
    };
    const storage = {
      getItem: () =>
        JSON.stringify([
          row,
          { ...row, id: "two", hash: undefined, state: "awaiting-wallet" },
        ]),
    };
    const restored = restoreSubmissions(storage, fixture);
    expect(restored[0].state).toBe("submitted");
    expect(restored[0].paymentConfirmed).toBe(false);
    expect(restored[1].state).toBe("unknown");
    expect(
      restoreSubmissions(storage, { ...fixture, vaultId: "other.test" }),
    ).toEqual([]);
    expect(restoreSubmissions({ getItem: () => "{bad" }, fixture)).toEqual([]);
  });
  it("only recognizes explicit wallet cancellation; network errors remain uncertain", () => {
    expect(isWalletRejection({ code: 4001 })).toBe(true);
    expect(isWalletRejection(new Error("timeout"))).toBe(false);
  });
});
it("reserves native account storage and gas before opening the wallet", async () => {
  let amount = "1000000000000000000000000";
  const transport: typeof fetch = async (_input, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    expect(method === "gas_price" ? params[0] : params.block_id).toBe("block");
    const result =
      method === "query"
        ? { amount, storage_usage: 100 }
        : method === "gas_price"
          ? { gas_price: "100000000" }
          : {
              runtime_config: {
                storage_amount_per_byte: "10000000000000000000",
              },
            };
    return new Response(JSON.stringify({ result }));
  };
  const client = new ChainClient(testnet, transport);
  await expect(
    client.checkFunding(snapshot(), samples[0].call),
  ).resolves.toBeUndefined();
  // Enough for the attached yoctoNEAR, but not storage plus prepaid gas.
  amount = "1000000000000000000000";
  await expect(
    client.checkFunding(snapshot(), samples[0].call),
  ).rejects.toThrow("Insufficient available NEAR");
  // Actual Builders admission rejection: enough for 2x current price, too
  // little for the protocol's pessimistic prepaid reserve.
  const creation = {
    ...samples[0].call,
    gas: "300000000000000",
    deposit: "7235220000000000000000000",
  };
  amount = "7367383505767004599999993";
  await expect(client.checkFunding(snapshot(), creation)).rejects.toThrow(
    "Insufficient available NEAR",
  );
  amount = "7567383505767004599999993";
  await expect(
    client.checkFunding(snapshot(), creation),
  ).resolves.toBeUndefined();
});
it.runIf(process.env.YIELDFUND_LIVE_SANDBOX === "1")(
  "reads and verifies the running Sandbox through the same browser adapter",
  async () => {
    const d = parseDeployment(
      JSON.parse(readFileSync("artifacts/browser-deployment.json", "utf8")),
    ) as Deployment;
    const client = new ChainClient(d);
    const s = await client.snapshot("alice.test");
    expect(s.accounting.nominal).toBe("1000000000");
    expect(s.accounting.donated).toBe("30000000");
    expect(s.treasuryBalance).toBe("10000000");
    expect(s.proposals[0].status).toBe("Approved");
    await client.checkFunding(s, samples[0].call);
    const bad = structuredClone(d);
    bad.codeHashes[bad.vaultId] = "0".repeat(64);
    await expect(new ChainClient(bad).snapshot()).rejects.toThrow(
      "code changed",
    );
    const changed = structuredClone(d);
    changed.daoPolicy.default_vote_policy.threshold = "1";
    await expect(new ChainClient(changed).snapshot()).rejects.toThrow(
      "policy changed",
    );
  },
  60000,
);

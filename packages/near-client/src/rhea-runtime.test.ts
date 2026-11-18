import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ChainClient,
  parseDeployment,
  type Deployment,
  type Operation,
} from "./chain";
import { prepareCall, recoveryKind } from "./actions";
import { formatAmount, parseAmount } from "../../domain/src/index";

// RPC fixtures exercise client validation, not live integration evidence.
function fixture() {
  const d = JSON.parse(
    readFileSync("docs/evidence/milestone-4-fixtures/deployment.json", "utf8"),
  ) as Deployment;
  Object.assign(d, {
    network: "mainnet",
    chainId: "mainnet",
    rpcUrl: "https://rpc.mainnet.fastnear.com",
    strategyMode: "rhea_lending",
    tokenSymbol: "wNEAR",
    transactionsEnabled: false,
  });
  Object.assign(d.config, {
    strategy_id: "contract.main.burrow.near",
    token_decimals: 24,
    rhea_extra_decimals: 0,
  });
  d.codeHashes = Object.fromEntries(
    [
      d.vaultId,
      d.config.token_id,
      d.config.strategy_id,
      d.config.beneficiary_id,
    ].map((id) => [id, "0".repeat(64)]),
  );
  const accounting = {
    mode: "rhea_lending",
    cash: "0",
    excluded: "0",
    nominal: "1000000000000000000000000",
    backing: "1000000000000000000000000",
    shortfall: "0",
    eligible_yield: "0",
    strategy_book: "1000000000000000000000000",
    donated: "0",
    reserved_outbound: "0",
    settled: false,
    paused: false,
    needs_reconciliation: false,
    active_operation: "1",
    queued_redemption: "1",
    checkpoint_at: "0",
    state_version: "1",
  };
  const position = {
    account_id: d.vaultId,
    supplied: [
      { token_id: d.config.token_id, balance: "1000000000000000000000001" },
    ],
    positions: {} as Record<string, unknown>,
    is_locked: false,
  };
  const rhea = {
    phase: "Ready",
    pending_raw_amount: "0",
    position_owner: d.vaultId,
    protocol_id: d.config.strategy_id,
    extra_decimals: 0,
  };
  const asset = {
    token_id: d.config.token_id,
    config: { extra_decimals: 0, can_withdraw: true },
  };
  const proposal = {
    id: 1,
    description: "Payment",
    status: "InProgress",
    votes: {},
    kind: {
      Transfer: {
        token_id: d.config.token_id,
        receiver_id: "alice.near",
        amount: "1",
        msg: null,
      },
    },
  };
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const values: Record<string, unknown> = {
    get_config: d.config,
    get_policy: d.daoPolicy,
    get_factory_info: d.factoryInfo,
    ft_metadata: { decimals: 24, symbol: "wNEAR" },
    get_rhea_status: rhea,
    get_account_all_positions: position,
    get_asset: asset,
    get_accounting: accounting,
    get_operations: [],
    storage_costs: { position: "1", operation: "1" },
    storage_balance_bounds: { min: "1" },
    ft_balance_of: "1",
    storage_balance_of: {},
    get_last_proposal_id: 2,
    get_proposals: [proposal, { id: 0, kind: { FunctionCall: {} } }],
    get_proposal: proposal,
  };
  const transport: typeof fetch = async (_input, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    calls.push({ method, params });
    let result: unknown;
    if (method === "status")
      result = { chain_id: "mainnet", sync_info: { syncing: false } };
    else if (method === "block")
      result = {
        header: {
          hash: "final-block",
          height: 10,
          timestamp_nanosec: String(BigInt(Date.now()) * 1000000n),
        },
      };
    else if (params.request_type === "view_account")
      result = { code_hash: "11111111111111111111111111111111" };
    else {
      if (!(params.method_name in values))
        throw new Error(`Unexpected simulator method: ${params.method_name}`);
      result = {
        result: [
          ...new TextEncoder().encode(
            JSON.stringify(values[params.method_name]),
          ),
        ],
      };
    }
    return new Response(JSON.stringify({ result }));
  };
  return {
    d,
    rhea,
    asset,
    position,
    values,
    calls,
    client: new ChainClient(d, transport),
  };
}
describe("Rhea runtime", () => {
  it("accepts an explicit read-only Rhea manifest and rejects unreviewed signing or precision", () => {
    const { d } = fixture();
    expect(parseDeployment(d)).toEqual(d);
    expect(() => parseDeployment({ ...d, transactionsEnabled: true })).toThrow(
      "acceptance",
    );
    expect(() =>
      parseDeployment({ ...d, strategyMode: "funded_simulator" }),
    ).toThrow("Mainnet requires Rhea");
    expect(() =>
      parseDeployment({
        ...d,
        config: { ...d.config, rhea_extra_decimals: 25 },
      }),
    ).toThrow("configuration");
  });
  it("reads the protocol at the pinned block, uses 24 decimals and filters non-payment proposals", async () => {
    const { client, calls } = fixture();
    const s = await client.snapshot();
    expect(s.strategy.position).toBe("1000000000000000000000001");
    expect(formatAmount(BigInt(s.strategy.position), 2, 24)).toBe(
      "1.000000000000000000000001",
    );
    expect(parseAmount("1.000000000000000000000001", 24).toString()).toBe(
      s.strategy.position,
    );
    expect(s.proposals.map((p) => p.id)).toEqual([1]);
    expect(
      calls
        .filter((c) => c.method === "query")
        .every((c) => c.params.block_id === "final-block"),
    ).toBe(true);
  });
  it.each(["precision", "owner", "borrowed", "metadata", "vault-mode"])(
    "fails closed on changed %s",
    async (kind) => {
      const f = fixture();
      if (kind === "precision") f.asset.config.extra_decimals = 1;
      if (kind === "owner") f.position.account_id = "someone.near";
      if (kind === "borrowed")
        f.position.positions = {
          regular: { borrowed: [{ balance: "1" }], collateral: [] },
        };
      if (kind === "metadata")
        f.values.ft_metadata = { decimals: 6, symbol: "wNEAR" };
      if (kind === "vault-mode")
        f.values.get_accounting = {
          ...(f.values.get_accounting as object),
          mode: "funded_simulator",
        };
      await expect(f.client.snapshot()).rejects.toThrow();
    },
  );
  it("rejects non-transfer proposal detail instead of offering a payment vote", async () => {
    const f = fixture();
    f.values.get_proposal = { id: 2, kind: { FunctionCall: {} } };
    await expect(f.client.proposal(2)).rejects.toThrow("not a payment");
  });
  it("continues only an identified Ready/Reading redemption and never replays unknown transfers", async () => {
    const { d, client } = fixture();
    const s = await client.snapshot();
    s.accountId = "alice.near";
    const operation: Operation = {
      id: "1",
      kind: "redemption",
      owner_id: "alice.near",
      units: "0",
      minimum: "0",
      payout: "0",
      stage: "redeeming",
      version: "8",
      started_at: "0",
      updated_at: "0",
      error: null,
    };
    const call = prepareCall(d, s, s.accountId, {
      kind: "continue-rhea",
      operation,
    });
    expect(call).toMatchObject({
      receiverId: d.vaultId,
      methodName: "continue_rhea_redemption",
      args: { operation_id: "1", version: "8" },
      deposit: "1",
      gas: "260000000000000",
    });
    for (const phase of ["Withdrawing", "Unknown", "Idle"] as const) {
      s.strategy.rhea!.phase = phase;
      expect(() =>
        prepareCall(d, s, s.accountId, { kind: "continue-rhea", operation }),
      ).toThrow("unresolved");
    }
    expect(recoveryKind(operation, "factory-v2", "rhea_lending")).toBeNull();
    expect(() =>
      prepareCall(d, s, s.accountId, { kind: "recover", operation }),
    ).toThrow("No automatic recovery");
  });
});

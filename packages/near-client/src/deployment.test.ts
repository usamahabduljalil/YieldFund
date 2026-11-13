import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ChainClient } from "./chain";
// Node-only deployment tooling is not bundled into the app.
// @ts-expect-error Plain JavaScript CLI module.
import {
  artifacts,
  auditPlan,
  inspectAccounts,
  makePlan,
  readOnlyRpcOverride,
  verifyArtifacts,
} from "../../../scripts/deployment.mjs";

describe("explicit read-only RPC replacement", () => {
  it("preserves the exact request while using the replacement URL", async () => {
    const response = { ok: true };
    const underlying = vi.fn().mockResolvedValue(response);
    const transport = readOnlyRpcOverride(
      "https://replacement.example",
      underlying,
    );
    const options = {
      method: "POST",
      body: JSON.stringify({
        method: "query",
        params: { account_id: "vault.testnet", block_id: "final-block" },
      }),
    };
    expect(await transport("https://retired.example", options)).toBe(response);
    expect(underlying).toHaveBeenCalledExactlyOnceWith(
      "https://replacement.example/",
      options,
    );
  });
  it.each([
    "http://rpc.example",
    "https://user:secret@rpc.example",
    "https://rpc.example?key=secret",
    "https://rpc.example#fragment",
  ])("rejects unsuitable endpoint %s", (url) => {
    expect(() => readOnlyRpcOverride(url)).toThrow("public HTTPS");
  });
  it("refuses broadcasting through the read-only override", () => {
    const underlying = vi.fn();
    const transport = readOnlyRpcOverride(
      "https://replacement.example",
      underlying,
    );
    expect(() =>
      transport("https://retired.example", {
        body: JSON.stringify({ method: "send_tx" }),
      }),
    ).toThrow("read methods");
    expect(underlying).not.toHaveBeenCalled();
  });
});

const key = "ed25519:11111111111111111111111111111111"; // Public fixture only; no signing key.
function input() {
  return {
    ...JSON.parse(
      readFileSync("deployments/testnet-input.example.json", "utf8"),
    ),
    operatorId: "operator.testnet",
    deployerId: "operator.testnet",
    contracts: Object.fromEntries(
      ["vault", "token", "strategy", "dao"].map((role) => [
        role,
        { accountId: `${role}.operator.testnet`, publicKey: key },
      ]),
    ),
    guardianId: "guardian.testnet",
    controllerId: "controller.testnet",
    lossSinkId: "sink.testnet",
    recipientId: "recipient.testnet",
    council: ["one.testnet", "two.testnet", "three.testnet"],
    authority:
      "Fixture only. Operator retains all deployment keys; council custody is unverified.",
  };
}
afterEach(() => vi.restoreAllMocks());
it("CLI verifies real artifacts, writes a review plan and refuses overwrites", () => {
  const directory = mkdtempSync(join(tmpdir(), "yieldfund-plan-"));
  try {
    const source = join(directory, "input.json"),
      output = join(directory, "plan.json");
    writeFileSync(source, JSON.stringify(input()));
    const run = () =>
      spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "scripts/deployment.mjs",
          "plan",
          source,
          output,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            YIELDFUND_ARTIFACT_DIRECTORY: "tests/fixtures/reviewed-testnet",
          },
        },
      );
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const original = readFileSync(output, "utf8");
    expect(JSON.parse(original).manifest.transactionsEnabled).toBe(false);
    expect(run().status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(original);
    writeFileSync(source, JSON.stringify({ ...input(), operatorId: null }));
    expect(run().status).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(original);
  } finally {
    for (const file of readdirSync(directory))
      unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
describe("unsigned testnet preparation", () => {
  it("accepts implicit operators/councils while using a separate named deployer", () => {
    const i = input();
    const actors = {
      operatorId: "ab".repeat(32),
      council: ["01".repeat(32), "02".repeat(32), "03".repeat(32)],
    };
    i.operatorId = actors.operatorId;
    i.guardianId = actors.operatorId;
    i.council = actors.council;
    const plan = makePlan(i);
    expect(plan.manifest.config.guardian_id).toBe(actors.operatorId);
    expect(plan.steps[0].signerId).toBe(i.deployerId);
    expect(plan.manifest.daoPolicy.roles[0].kind.Group).toEqual(actors.council);
    i.deployerId = actors.operatorId;
    expect(() => makePlan(i)).toThrow("named testnet deployer");
  });
  it("uses exact normal artifacts and atomic self-initialization, with signing disabled", () => {
    const plan = makePlan(input());
    expect(plan.manifest.transactionsEnabled).toBe(false);
    expect(plan.manifest.factoryInfo).toEqual({
      factory_id: "dao.operator.testnet",
      auto_update: true,
    });
    expect(plan.manifest.config.metadata_hash).toMatch(/^[a-f0-9]{64}$/);
    for (const role of Object.keys(artifacts)) {
      const init = plan.steps.find(
        (s: { id: string }) => s.id === `initialize-${role}`,
      );
      expect(init.signerId).toBe(init.receiverId);
      expect(init.actions.map((a: { type: string }) => a.type)).toEqual([
        "DeployContract",
        "FunctionCall",
      ]);
      expect(init.actions[0].sha256).toBe(artifacts[role][1]);
      expect(init.actions[1].methodName).toBe("new");
    }
    expect(BigInt(plan.attachedDepositUpperBound)).toBeGreaterThan(
      22n * 10n ** 24n,
    );
    expect(plan.gasExcluded).toBe(true);
    expect(
      plan.steps.filter((s: { id: string }) => s.id.startsWith("register-"))
        .length,
    ).toBe(11);
  });
  it.each([
    [
      "mainnet",
      (i: ReturnType<typeof input>) => {
        i.operatorId = "operator.near";
      },
    ],
    [
      "foreign contract",
      (i: ReturnType<typeof input>) => {
        i.contracts.vault.accountId = "vault.other.testnet";
      },
    ],
    [
      "duplicate council",
      (i: ReturnType<typeof input>) => {
        i.council[1] = i.council[0];
      },
    ],
    [
      "secret-like key",
      (i: ReturnType<typeof input>) => {
        i.contracts.vault.publicKey = `ed25519:${"2".repeat(88)}`;
      },
    ],
    [
      "bad key length",
      (i: ReturnType<typeof input>) => {
        i.contracts.vault.publicKey = `ed25519:${"1".repeat(33)}`;
      },
    ],
    [
      "insufficient supply",
      (i: ReturnType<typeof input>) => {
        i.totalSupply = i.depositCap;
      },
    ],
    [
      "credential URL",
      (i: ReturnType<typeof input>) => {
        i.rpcUrl = "https://rpc.testnet.near.org/?key=secret";
      },
    ],
    [
      "contract actor",
      (i: ReturnType<typeof input>) => {
        i.guardianId = i.contracts.dao.accountId;
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const i = input();
    mutate(i);
    expect(() => makePlan(i)).toThrow();
  });
  it("rejects the unfilled template without inventing accounts", () => {
    expect(() =>
      makePlan(
        JSON.parse(
          readFileSync("deployments/testnet-input.example.json", "utf8"),
        ),
      ),
    ).toThrow();
  });
  it("rejects a missing artifact", async () => {
    await expect(verifyArtifacts("does-not-exist")).rejects.toThrow();
  });
  it("rejects modified artifact bytes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "yieldfund-wasm-"));
    const file = join(directory, artifacts.vault[0]);
    try {
      writeFileSync(file, "unreviewed");
      await expect(verifyArtifacts(directory)).rejects.toThrow(
        "Unreviewed artifact",
      );
    } finally {
      unlinkSync(file);
      rmdirSync(directory);
    }
  });
});

describe("testnet actor readiness", () => {
  function rpcFixture(mode: string) {
    return vi.fn(async (_url, options) => {
      const { method, params } = JSON.parse(options.body);
      if (method === "status")
        return Response.json({
          result: {
            chain_id: mode === "wrong network" ? "mainnet" : "testnet",
            sync_info: { syncing: false },
          },
        });
      if (method === "block")
        return Response.json({
          result: {
            header: {
              hash: "final",
              height: 10,
              timestamp_nanosec: String(BigInt(Date.now()) * 1000000n),
            },
          },
        });
      expect(method).toBe("query");
      expect(params.block_id).toBe("final");
      return mode === "exists"
        ? Response.json({ result: { block_hash: "final", amount: "1" } })
        : Response.json({
            error: {
              cause: {
                name:
                  mode === "RPC failure" ? "INTERNAL_ERROR" : "UNKNOWN_ACCOUNT",
                info: {
                  block_hash: "final",
                  requested_account_id: params.account_id,
                },
              },
            },
          });
    });
  }
  it("records explicit absence at a finalized testnet block", async () => {
    const report = await inspectAccounts(input(), rpcFixture("absent"));
    expect(report.allExist).toBe(false);
    expect(report.observations).toHaveLength(4);
    expect(
      report.observations.every(
        (a: { status: string }) => a.status === "not_created",
      ),
    ).toBe(true);
  });
  it("records existence without claiming sufficient funding", async () => {
    expect(
      (await inspectAccounts(input(), rpcFixture("exists"))).allExist,
    ).toBe(true);
  });
  it.each(["wrong network", "RPC failure"])(
    "does not mistake %s for missing accounts",
    async (mode) => {
      await expect(
        inspectAccounts(input(), rpcFixture(mode)),
      ).rejects.toThrow();
    },
  );
});

function auditFixture(
  change?: (params: Record<string, string>, result: any) => unknown,
) {
  const plan = makePlan(input());
  vi.spyOn(ChainClient.prototype, "snapshot").mockResolvedValue({
    blockHash: "final-block",
    height: 123,
    tokenStorageCost: "1250000000000000000000",
    strategy: { busy: false, position: "0" },
    accounting: {
      active_operation: null,
      queued_redemption: null,
      needs_reconciliation: false,
    },
  } as never);
  const calls: Record<string, string>[] = [];
  const transport = vi.fn(async (_url, options) => {
    const request = JSON.parse(options.body);
    expect(request.method).toBe("query");
    const p = request.params;
    calls.push(p);
    let result: any;
    if (p.request_type === "view_access_key_list")
      result = {
        block_hash: "final-block",
        keys: [
          {
            public_key: key,
            access_key: { nonce: 7, permission: "FullAccess" },
          },
        ],
      };
    else if (p.request_type === "view_account")
      result = { amount: "5000000000000000000000000" };
    else
      result = {
        result: [
          ...Buffer.from(
            JSON.stringify(
              p.method_name === "ft_total_supply"
                ? plan.totalSupply
                : { total: "1250000000000000000000", available: "0" },
            ),
          ),
        ],
      };
    const changed = change?.(p, result);
    return Response.json({ result: changed ?? result });
  });
  return { plan, calls, transport };
}
describe("read-only authority audit", () => {
  it("pins every read to the snapshot and never enables transactions", async () => {
    const f = auditFixture();
    const report = await auditPlan(f.plan, f.transport);
    expect(report.status).toBe("read-only-audit-passed");
    expect(report.transactionsEnabled).toBe(false);
    expect(report.planSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.calls.every((p) => p.block_id === "final-block")).toBe(true);
    expect(Object.keys(report.authority)).toHaveLength(4);
  });
  it.each(["extra key", "different permission", "wrong block"])(
    "rejects %s",
    async (kind) => {
      const f = auditFixture((p, r) => {
        if (p.request_type !== "view_access_key_list") return;
        if (kind === "extra key") r.keys.push(r.keys[0]);
        if (kind === "different permission")
          r.keys[0].access_key.permission = {
            FunctionCall: {
              receiver_id: "attacker.testnet",
              method_names: [],
              allowance: null,
            },
          };
        if (kind === "wrong block") r.block_hash = "other-block";
        return r;
      });
      await expect(auditPlan(f.plan, f.transport)).rejects.toThrow();
    },
  );
  it("rejects missing token registration", async () => {
    const f = auditFixture((p) =>
      p.method_name === "storage_balance_of"
        ? { result: [...Buffer.from("null")] }
        : undefined,
    );
    await expect(auditPlan(f.plan, f.transport)).rejects.toThrow(
      "Token storage missing",
    );
  });
  it("rejects changed supply", async () => {
    const f = auditFixture((p) =>
      p.method_name === "ft_total_supply"
        ? { result: [...Buffer.from('"1"')] }
        : undefined,
    );
    await expect(auditPlan(f.plan, f.transport)).rejects.toThrow(
      "Unexpected token supply",
    );
  });
  it("rejects altered instructions before any RPC", async () => {
    const f = auditFixture();
    f.plan.steps[0].receiverId = "attacker.testnet";
    await expect(auditPlan(f.plan, f.transport)).rejects.toThrow("regenerate");
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("rejects unfinished recovery", async () => {
    const f = auditFixture();
    vi.mocked(ChainClient.prototype.snapshot).mockResolvedValue({
      blockHash: "final-block",
      height: 123,
      tokenStorageCost: "1",
      strategy: { busy: true },
      accounting: {},
    } as never);
    await expect(auditPlan(f.plan, f.transport)).rejects.toThrow(
      "outstanding operations",
    );
  });
});

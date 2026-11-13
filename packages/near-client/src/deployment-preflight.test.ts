import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fundingAssessment,
  preflightPlan,
} from "../../../scripts/deployment-preflight.mjs";

const plan = JSON.parse(
  readFileSync("deployments/testnet-plan.review.json", "utf8"),
);
const unit = 10n ** 24n;
const protocol = {
  chain_id: "testnet",
  protocol_version: 88,
  runtime_config: { storage_amount_per_byte: "10000000000000000000" },
};
const sizes = {
  vault: { bytes: 381967 },
  token: { bytes: 255425 },
  strategy: { bytes: 219748 },
  dao: { bytes: 495447 },
};
describe("deployment funding assessment", () => {
  it("reserves actor storage and fees without counting staking or council balances", () => {
    const f = fundingAssessment(plan, sizes, protocol, "100000000", {
      amount: String(10n * unit),
      locked: String(100n * unit),
      storage_usage: 182,
    });
    expect(f.deployer.available).toBe("9998180000000000000000000");
    expect(f.deployer.required).toBe("24240000000000000000000000");
    expect(f.deployer.shortfall).toBe("14241820000000000000000000");
    expect(Object.values(f.contracts).every((c: any) => c.sufficient)).toBe(
      true,
    );
  });
  it("clamps available funds at zero when storage exceeds liquid amount", () => {
    expect(
      fundingAssessment(plan, sizes, protocol, "100000000", {
        amount: "1",
        storage_usage: 182,
      }).deployer.available,
    ).toBe("0");
  });
  it("accepts a funded deployer while retaining an operating reserve", () => {
    const f = fundingAssessment(plan, sizes, protocol, "100000000", {
      amount: String(25n * unit),
      storage_usage: 182,
    });
    expect(f.deployer.shortfall).toBe("0");
    expect(f.deployer.operatingReserve).toBe(String(unit));
  });
  it("detects protocol/storage increases that invalidate contract allocations", () => {
    const p = structuredClone(protocol);
    p.runtime_config.storage_amount_per_byte = "20000000000000000000";
    const f = fundingAssessment(plan, sizes, p, "100000000", {
      amount: String(25n * unit),
      storage_usage: 182,
    });
    expect(Object.values(f.contracts).some((c: any) => !c.sufficient)).toBe(
      true,
    );
  });
  it("detects gas-price spikes instead of assuming last run fees", () => {
    const f = fundingAssessment(plan, sizes, protocol, "1000000000", {
      amount: String(25n * unit),
      storage_usage: 182,
    });
    expect(BigInt(f.deployer.shortfall)).toBeGreaterThan(0n);
  });
  it("rejects malformed protocol/account values", () => {
    expect(() =>
      fundingAssessment(plan, sizes, protocol, "0", {
        amount: "1",
        storage_usage: 182,
      }),
    ).toThrow();
    expect(() =>
      fundingAssessment(plan, sizes, protocol, "1", {
        amount: "1",
        storage_usage: -1,
      }),
    ).toThrow();
  });
});

function mockTransport(mode = "ready") {
  return vi.fn(async (_url, options) => {
    const { method, params: p } = JSON.parse(options.body);
    let result: any;
    if (method === "status")
      result = {
        chain_id: mode === "mainnet" ? "mainnet" : "testnet",
        sync_info: { syncing: false },
      };
    else if (method === "block")
      result = {
        header: {
          hash: "final",
          height: 50,
          timestamp_nanosec: String(
            BigInt(Date.now() - (mode === "stale" ? 180000 : 0)) * 1000000n,
          ),
        },
      };
    else if (method === "EXPERIMENTAL_protocol_config") {
      expect(p.block_id).toBe("final");
      result = protocol;
    } else if (method === "gas_price") {
      expect(p).toEqual(["final"]);
      result = { gas_price: "100000000" };
    } else {
      expect(method).toBe("query");
      expect(p.block_id).toBe("final");
      if (p.request_type === "view_account") {
        if (
          (Object.keys(plan.expectedKeys).includes(p.account_id) &&
            mode !== "existing contract") ||
          (mode === "missing actor" && p.account_id === plan.actors.recipient)
        ) {
          return Response.json({
            error: {
              cause: {
                name:
                  mode === "RPC error" ? "INTERNAL_ERROR" : "UNKNOWN_ACCOUNT",
                info: {
                  block_hash: "final",
                  requested_account_id: p.account_id,
                },
              },
            },
          });
        }
        result = {
          block_hash: "final",
          amount: String((mode === "underfunded" ? 10n : 25n) * unit),
          storage_usage: 182,
          code_hash: "11111111111111111111111111111111",
        };
      } else
        result = {
          block_hash: mode === "wrong block" ? "different" : "final",
          keys: [
            {
              public_key: "ed25519:11111111111111111111111111111111",
              access_key: {
                permission:
                  mode === "restricted key"
                    ? {
                        FunctionCall: {
                          receiver_id: plan.manifest.vaultId,
                          method_names: [],
                          allowance: null,
                        },
                      }
                    : "FullAccess",
              },
            },
          ],
        };
    }
    return Response.json({ result });
  });
}
const artifactDirectory = "tests/fixtures/reviewed-testnet";
describe("preflight RPC boundary with real artifact hashes", () => {
  it("accepts a sufficiently funded fresh setup, without authorizing signing", async () => {
    const transport = mockTransport();
    const r = await preflightPlan(plan, { transport, artifactDirectory });
    expect(r.readyForReview).toBe(true);
    expect(r.transactionsEnabled).toBe(false);
    expect(
      Object.values(r.contractAccounts).every(
        (a: any) => a.status === "absent",
      ),
    ).toBe(true);
  });
  it.each([
    "underfunded",
    "existing contract",
    "missing actor",
    "restricted key",
  ])("records %s as a blocker", async (mode) => {
    const r = await preflightPlan(plan, {
      transport: mockTransport(mode),
      artifactDirectory,
    });
    expect(r.readyForReview).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
  });
  it.each(["mainnet", "stale", "RPC error", "wrong block"])(
    "rejects inconclusive or mismatched %s evidence",
    async (mode) => {
      await expect(
        preflightPlan(plan, {
          transport: mockTransport(mode),
          artifactDirectory,
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects a changed plan before making a request", async () => {
    const p = structuredClone(plan);
    p.steps[0].actions[1].deposit = "1";
    const transport = mockTransport();
    await expect(
      preflightPlan(p, { transport, artifactDirectory }),
    ).rejects.toThrow("reproducible");
    expect(transport).not.toHaveBeenCalled();
  });
});

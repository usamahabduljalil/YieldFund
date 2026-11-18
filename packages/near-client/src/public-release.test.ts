import { describe, expect, it } from "vitest";
// @ts-expect-error Node-only build tool, never included in the browser bundle.
import {
  acceptanceChecks,
  releaseDigest,
  validatePublicRelease,
} from "../../../scripts/public-release.mjs";

function fixture() {
  const runtime = {
    mode: "chain",
    network: "testnet",
    transactionsEnabled: true,
    vaultId: "v-commons.factory.testnet",
    config: {
      campaign_id: "commons",
      token_id: "token.testnet",
      strategy_id: "s-commons.factory.testnet",
      disclosure_version: "factory-v2",
    },
    codeHashes: {
      "v-commons.factory.testnet": "a".repeat(64),
      "s-commons.factory.testnet": "b".repeat(64),
    },
  };
  const registry = {
    deployments: [
      {
        network: "testnet",
        chainId: "testnet",
        recoveryVersion: 2,
        transactionsEnabled: true,
        factoryId: "factory.testnet",
        tokenId: "token.testnet",
        vaultCodeHash: "a".repeat(64),
        strategyCodeHash: "b".repeat(64),
      },
    ],
  };
  const review = { steps: [{ id: "fixture-only" }] };
  const acceptance = {
    status: "accepted",
    runtimeSha256: releaseDigest(runtime),
    registrySha256: releaseDigest(registry),
    reviewSha256: releaseDigest(review),
    checks: Object.fromEntries(
      acceptanceChecks.map((name: string) => [name, "passed"]),
    ),
    finalizedTransactions: ["2".repeat(44)],
  };
  return { runtime, registry, review, acceptance };
}
describe("public signing release guard", () => {
  it("permits read-only Rhea mainnet but rejects any enabled registry or simulator", () => {
    const { runtime, registry } = fixture();
    const rhea = {
      ...runtime,
      network: "mainnet",
      strategyMode: "rhea_lending",
      transactionsEnabled: false,
    };
    expect(() => validatePublicRelease(rhea, registry)).toThrow("read-only");
    registry.deployments[0].transactionsEnabled = false;
    expect(validatePublicRelease(rhea, registry)).toBe("read-only");
    expect(() =>
      validatePublicRelease(
        { ...rhea, strategyMode: "funded_simulator" },
        registry,
      ),
    ).toThrow();
  });
  it("keeps legacy read-only builds available without an acceptance record", () => {
    const { runtime, registry } = fixture();
    runtime.transactionsEnabled = false;
    runtime.config.disclosure_version = "1.0";
    registry.deployments[0].transactionsEnabled = false;
    expect(validatePublicRelease(runtime, registry)).toBe("read-only");
  });
  it("blocks missing acceptance, registry-only signing, legacy contracts and mainnet", () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => {
        f.acceptance.status = "pending";
      },
      (f: ReturnType<typeof fixture>) => {
        f.runtime.transactionsEnabled = false;
      },
      (f: ReturnType<typeof fixture>) => {
        f.runtime.config.disclosure_version = "factory-v1";
      },
      (f: ReturnType<typeof fixture>) => {
        f.registry.deployments[0].network = "mainnet";
      },
      (f: ReturnType<typeof fixture>) => {
        f.runtime.network = "mainnet";
      },
    ]) {
      const f = fixture();
      change(f);
      expect(() =>
        validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
      ).toThrow();
    }
    const f = fixture();
    expect(() =>
      validatePublicRelease(f.runtime, f.registry, undefined, f.review),
    ).toThrow();
  });
  it("requires every acceptance check and unchanged manifests/review", () => {
    for (const name of acceptanceChecks) {
      const f = fixture();
      f.acceptance.checks[name] = "pending";
      expect(() =>
        validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
      ).toThrow();
    }
    const f = fixture();
    f.review.steps[0].id = "different-plan";
    expect(() =>
      validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
    ).toThrow();
    f.acceptance.reviewSha256 = releaseDigest(f.review);
    f.registry.deployments[0].tokenId = "other.testnet";
    expect(() =>
      validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
    ).toThrow();
  });
  it("accepts exact reviewed evidence and rejects missing or reused receipts", () => {
    const f = fixture();
    expect(
      validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
    ).toBe("signing-enabled");
    f.acceptance.finalizedTransactions = [];
    expect(() =>
      validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
    ).toThrow();
    f.review.steps.push({ id: "second" });
    f.acceptance.reviewSha256 = releaseDigest(f.review);
    f.acceptance.finalizedTransactions = ["2".repeat(44), "2".repeat(44)];
    expect(() =>
      validatePublicRelease(f.runtime, f.registry, f.acceptance, f.review),
    ).toThrow();
  });
});

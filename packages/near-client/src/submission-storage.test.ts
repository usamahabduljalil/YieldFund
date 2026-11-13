import { describe, it, expect } from "vitest";
import { persistSubmissions, scope, type Submission } from "./actions";
import type { Deployment } from "./chain";

const deployment = (vaultId: string) =>
  ({
    network: "testnet",
    chainId: "testnet",
    rpcUrl: "https://rpc.testnet.near.org",
    vaultId,
    codeHashes: { [vaultId]: "hash" },
  }) as Deployment;
const row = (d: Deployment, id: string) =>
  ({ id, scope: scope(d), state: "unknown" }) as Submission;
const memory = (initial: string) => {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
};
describe("campaign activity persistence", () => {
  it("preserves other campaigns while updating the current campaign", () => {
    const a = deployment("alpha.testnet"),
      b = deployment("beta.testnet");
    const storage = memory(JSON.stringify([row(a, "a"), row(b, "b")]));
    persistSubmissions(storage, a, [{ ...row(a, "a"), state: "finalized" }]);
    expect(JSON.parse(storage.getItem())).toEqual([
      row(b, "b"),
      { ...row(a, "a"), state: "finalized" },
    ]);
  });
  it("does not truncate unresolved submissions", () => {
    const a = deployment("alpha.testnet"),
      rows = Array.from({ length: 110 }, (_, i) => row(a, String(i)));
    const storage = memory("[]");
    persistSubmissions(storage, a, rows);
    expect(JSON.parse(storage.getItem())).toHaveLength(110);
  });
  it("rejects mixed scopes and preserves malformed storage", () => {
    const a = deployment("alpha.testnet"),
      b = deployment("beta.testnet");
    const storage = memory("[]");
    expect(() => persistSubmissions(storage, a, [row(b, "b")])).toThrow(
      "scope mismatch",
    );
    const corrupt = memory("{bad");
    expect(() => persistSubmissions(corrupt, a, [])).toThrow();
    expect(corrupt.getItem()).toBe("{bad");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_HISTORY,
  assertRegistryAvailable,
  registryHistory,
  saveRegistrySubmission,
  checkRegistryReceipt,
  type RegistrySubmission,
} from "./registry-actions";
import type { RegistryDeployment } from "./campaigns";
import type { Deployment, Transaction } from "./chain";
const baseline = JSON.parse(
  readFileSync("deployments/testnet.json", "utf8"),
) as Deployment;
const d = {
  network: "testnet",
  chainId: "testnet",
  factoryId: "factory.testnet",
  transactionsEnabled: true,
} as RegistryDeployment;
const row: RegistrySubmission = {
  id: "one",
  scope: "testnet:factory.testnet",
  account: "alice.testnet",
  call: {
    receiverId: "factory.testnet",
    methodName: "create_campaign",
    args: { id: "alpha" },
    gas: "300000000000000",
    deposit: "10",
  },
  minHeight: 5,
  createdAt: 1,
  state: "unknown",
  receipts: [],
};
function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
}
describe("registry submission recovery", () => {
  it("preserves other registries and refuses identity changes", () => {
    const s = storage();
    saveRegistrySubmission(s, row);
    saveRegistrySubmission(s, {
      ...row,
      id: "two",
      scope: "testnet:other.testnet",
    });
    saveRegistrySubmission(s, { ...row, state: "submitted", hash: "hash" });
    expect(registryHistory(s)).toHaveLength(2);
    expect(() =>
      saveRegistrySubmission(s, { ...row, account: "bob.testnet" }),
    ).toThrow("identity");
  });
  it("keeps corrupt storage intact", () => {
    const s = storage("broken");
    expect(() => saveRegistrySubmission(s, row)).toThrow();
    expect(s.getItem()).toBe("broken");
    expect(REGISTRY_HISTORY).toContain("registry");
  });
  it.each(["awaiting-wallet", "submitted", "unknown", "attention"] as const)(
    "blocks a second transaction while %s",
    (state) => {
      expect(() =>
        assertRegistryAvailable([{ ...row, state }], d, row.account),
      ).toThrow("existing");
      expect(() =>
        assertRegistryAvailable([{ ...row, state }], d, "bob.testnet"),
      ).not.toThrow();
    },
  );
  it("never enables mainnet or read-only sending", () => {
    expect(() =>
      assertRegistryAvailable([], { ...d, network: "mainnet" }, row.account),
    ).toThrow("read only");
    expect(() =>
      assertRegistryAvailable(
        [],
        { ...d, transactionsEnabled: false },
        row.account,
      ),
    ).toThrow("read only");
  });
  it("checks actual finalized call identity and all linked receipts", () => {
    const tx: Transaction = {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        hash: "hash",
        signer_id: row.account,
        receiver_id: row.call.receiverId,
        actions: [
          {
            FunctionCall: {
              method_name: row.call.methodName,
              args: btoa(JSON.stringify(row.call.args)),
              deposit: row.call.deposit,
              gas: row.call.gas,
            },
          },
        ],
      },
      transaction_outcome: {
        id: "root",
        block_hash: "block",
        outcome: {
          executor_id: row.account,
          logs: [],
          receipt_ids: ["child"],
          status: { SuccessReceiptId: "child" },
        },
      },
      receipts_outcome: [
        {
          id: "child",
          block_hash: "block",
          outcome: {
            executor_id: row.call.receiverId,
            logs: [],
            receipt_ids: [],
            status: { SuccessValue: "" },
          },
        },
      ],
    };
    expect(
      checkRegistryReceipt(tx, { ...row, hash: "hash" }, baseline).status,
    ).toBe("finalized");
    expect(() =>
      checkRegistryReceipt(
        { ...tx, receipts_outcome: [] },
        { ...row, hash: "hash" },
        baseline,
      ),
    ).toThrow("Incomplete");
    expect(() =>
      checkRegistryReceipt(
        tx,
        { ...row, hash: "hash", call: { ...row.call, deposit: "11" } },
        baseline,
      ),
    ).toThrow("parameters");
    tx.receipts_outcome[0].outcome.status = {
      Failure: { error: "registration failed" },
    };
    expect(
      checkRegistryReceipt(tx, { ...row, hash: "hash" }, baseline).status,
    ).toBe("attention");
  });
});

it("permits only matching campaign recovery after a finalized incomplete setup", () => {
  const intent = {
    ...row.call,
    methodName: "recover_campaign",
    deposit: "1",
    args: { id: "alpha", version: "3" },
  };
  const incomplete = {
    ...row,
    state: "attention" as const,
    hash: "hash",
    receipts: ["receipt"],
  };
  expect(() =>
    assertRegistryAvailable(
      [incomplete],
      { ...d, recoveryVersion: 2 },
      row.account,
      intent,
    ),
  ).not.toThrow();
  for (const patch of [
    { state: "unknown" as const },
    { hash: undefined },
    { receipts: [] },
  ]) {
    expect(() =>
      assertRegistryAvailable(
        [{ ...incomplete, ...patch }],
        { ...d, recoveryVersion: 2 },
        row.account,
        intent,
      ),
    ).toThrow("existing");
  }
  expect(() =>
    assertRegistryAvailable(
      [incomplete],
      { ...d, recoveryVersion: 2 },
      row.account,
      {
        ...intent,
        args: { id: "beta" },
      },
    ),
  ).toThrow("existing");
  expect(() =>
    assertRegistryAvailable(
      [incomplete],
      { ...d, recoveryVersion: 2 },
      row.account,
      row.call,
    ),
  ).toThrow("existing");
  expect(() =>
    assertRegistryAvailable(
      [{ ...incomplete, state: "recovered" }],
      d,
      row.account,
      row.call,
    ),
  ).not.toThrow();
});

import { describe, it, expect } from "vitest";
import {
  parseAmount,
  formatAmount,
  transition,
  emptyLedger,
  accounting,
  quoteWithdrawal,
  assertInvariants,
  PREVIEW_ACCOUNT,
  MAX_U128,
  type Ledger,
} from "./index";
const deposit = (s: Ledger, amount = 1000n) =>
  transition(s, { type: "deposit", owner: PREVIEW_ACCOUNT, amount });
const result = (s: Ledger, amount: bigint) =>
  transition(
    transition(
      transition(s, { type: "allocate", amount: accounting(s).backing }),
      { type: "strategy-result", amount },
    ),
    { type: "checkpoint" },
  );
describe("integer amounts", () => {
  it("rejects exponent notation, negatives, excessive decimals and overflow", () => {
    for (const v of [
      "1e3",
      "-1",
      "0.0000001",
      "NaN",
      (MAX_U128 + 1n).toString(),
    ])
      expect(() => parseAmount(v)).toThrow();
  });
  it("preserves values beyond Number precision and never hides small payouts", () => {
    expect(parseAmount("9007199254740993.123456")).toBe(
      9007199254740993123456n,
    );
    expect(formatAmount(1234567890n)).toBe("1,234.56789");
    expect(formatAmount(1n)).toBe("0.000001");
  });
});
describe("capital accounting", () => {
  it("donates only realized profit and preserves nominal backing", () => {
    let s = result(deposit(emptyLedger()), 30n);
    expect(accounting(s).surplus).toBe(30n);
    s = transition(s, { type: "begin-donation", amount: 30n });
    s = transition(s, { type: "resolve-transfer", outcome: "success" });
    expect(accounting(s).backing).toBe(1000n);
    expect(s.treasury).toBe(30n);
    expect(() =>
      transition(s, { type: "begin-donation", amount: 1n }),
    ).toThrow();
  });
  it("allocates losses proportionally, blocks new deposits and yield", () => {
    let s = result(deposit(emptyLedger()), -100n);
    expect(quoteWithdrawal(s, 200n)).toBe(180n);
    expect(() => deposit(s)).toThrow();
    expect(() =>
      transition(s, { type: "begin-donation", amount: 1n }),
    ).toThrow();
    s = transition(s, {
      type: "request-withdrawal",
      owner: PREVIEW_ACCOUNT,
      units: 200n,
      minimum: 180n,
    });
    s = transition(s, { type: "begin-withdrawal", id: s.withdrawals[0].id });
    s = transition(s, { type: "resolve-transfer", outcome: "success" });
    expect(accounting(s)).toMatchObject({ backing: 720n, nominal: 800n });
  });
  it("does not give new depositors accrued surplus", () => {
    let s = result(deposit(emptyLedger()), 30n);
    s = deposit(s, 200n);
    expect(quoteWithdrawal(s, 200n)).toBe(200n);
    expect(accounting(s).surplus).toBe(30n);
  });
  it("quarantines unsolicited transfers", () => {
    let s = deposit(emptyLedger());
    s = transition(s, { type: "direct-transfer", amount: 500n });
    expect(accounting(s).surplus).toBe(0n);
    expect(() =>
      transition(s, { type: "begin-donation", amount: 500n }),
    ).toThrow();
  });
  it("requires complete redemption and honors minimum payout", () => {
    let s = deposit(emptyLedger());
    s = transition(s, {
      type: "request-withdrawal",
      owner: PREVIEW_ACCOUNT,
      units: 200n,
      minimum: 200n,
    });
    s = result(s, -100n);
    expect(() =>
      transition(s, { type: "begin-withdrawal", id: s.withdrawals[0].id }),
    ).toThrow(/minimum/);
    expect(s.withdrawals[0].status).toBe("queued");
  });
  it("does not treat illiquidity as completion", () => {
    let s = transition(deposit(emptyLedger()), {
      type: "allocate",
      amount: 1000n,
    });
    s = transition(s, { type: "liquidity", value: true });
    expect(() => transition(s, { type: "checkpoint" })).toThrow(/liquidity/);
    expect(() => transition(s, { type: "begin-donation", amount: 1n })).toThrow(
      /Redeem/,
    );
  });
  it("reserves units against duplicate requests", () => {
    let s = deposit(emptyLedger());
    s = transition(s, {
      type: "request-withdrawal",
      owner: PREVIEW_ACCOUNT,
      units: 800n,
      minimum: 0n,
    });
    expect(() =>
      transition(s, {
        type: "request-withdrawal",
        owner: PREVIEW_ACCOUNT,
        units: 300n,
        minimum: 0n,
      }),
    ).toThrow();
    expect(() =>
      transition(s, {
        type: "cancel-withdrawal",
        owner: "intruder",
        id: s.withdrawals[0].id,
      }),
    ).toThrow();
  });
  it("locks unknown transfers, restores failure once and pays once", () => {
    let s = deposit(emptyLedger());
    s = transition(s, {
      type: "request-withdrawal",
      owner: PREVIEW_ACCOUNT,
      units: 200n,
      minimum: 0n,
    });
    const id = s.withdrawals[0].id;
    s = transition(s, { type: "begin-withdrawal", id });
    s = transition(s, { type: "resolve-transfer", outcome: "unknown" });
    expect(() => deposit(s)).toThrow(/reconciliation/);
    s = transition(s, { type: "resolve-transfer", outcome: "failure" });
    expect(accounting(s).nominal).toBe(1000n);
    expect(() =>
      transition(s, { type: "resolve-transfer", outcome: "failure" }),
    ).toThrow();
    s = transition(transition(s, { type: "begin-withdrawal", id }), {
      type: "resolve-transfer",
      outcome: "success",
    });
    expect(s.paidWithdrawals).toBe(200n);
    expect(() => transition(s, { type: "begin-withdrawal", id })).toThrow();
  });
  it("settles final backing without stranded dust", () => {
    const s = result(deposit(emptyLedger(), 3n), -1n);
    expect(quoteWithdrawal(s, 3n)).toBe(2n);
    expect(quoteWithdrawal(s, 1n)).toBe(0n);
  });
  it("reconciles many depositors and withdrawal orders", () => {
    let s = emptyLedger();
    for (let i = 1; i <= 30; i++) {
      s = transition(s, {
        type: "deposit",
        owner: `owner-${i}`,
        amount: BigInt(i * 17),
      });
    }
    s = result(s, -431n);
    for (let i = 30; i >= 1; i--) {
      const owner = `owner-${i}`;
      s = transition(s, {
        type: "request-withdrawal",
        owner,
        units: s.positions[owner],
        minimum: 0n,
      });
      s = transition(s, {
        type: "begin-withdrawal",
        id: s.withdrawals.at(-1)!.id,
      });
      s = transition(s, { type: "resolve-transfer", outcome: "success" });
      assertInvariants(s);
    }
    expect(accounting(s).nominal).toBe(0n);
    expect(accounting(s).backing).toBe(0n);
  });
  it("isolates treasury funds and requires distinct votes", () => {
    let s = result(deposit(emptyLedger()), 30n);
    s = transition(transition(s, { type: "begin-donation", amount: 30n }), {
      type: "resolve-transfer",
      outcome: "success",
    });
    s = transition(s, {
      type: "propose",
      title: "Fix SDK",
      recipient: "Example contributor",
      amount: 20n,
    });
    const id = s.proposals[0].id;
    s = transition(s, { type: "vote", id, member: "Alex" });
    expect(() => transition(s, { type: "pay-proposal", id })).toThrow();
    expect(() => transition(s, { type: "vote", id, member: "Alex" })).toThrow();
    s = transition(s, { type: "vote", id, member: "Sam" });
    s = transition(s, { type: "pay-proposal", id });
    expect(s.treasury).toBe(10n);
    expect(accounting(s).backing).toBe(1000n);
    expect(() => transition(s, { type: "pay-proposal", id })).toThrow();
  });
});

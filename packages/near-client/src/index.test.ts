import { describe, expect, it } from "vitest";
import { buildPaymentProposal, buildProposalAction, type DaoPolicy, type TransferKind } from "./index";
const deployment = { daoId: "treasury.test", tokenId: "token.test" };
const policy: DaoPolicy = {
  roles: [{ name: "council", kind: { Group: ["member1.test", "member2.test", "member3.test"] },
    permissions: ["transfer:AddProposal", "transfer:VoteApprove", "transfer:VoteReject", "transfer:Finalize"], vote_policy: {} }],
  proposal_bond: "100000000000000000000000", proposal_period: "604800000000000",
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "2", threshold: "2" },
};
const payment = { recipientId: "recipient.test", amount: "20000000", description: "Commons maintenance" };
const kind: TransferKind = { Transfer: { token_id: deployment.tokenId, receiver_id: payment.recipientId, amount: payment.amount, msg: null } };
describe("unsigned Sputnik payments", () => {
  it("uses the fixed token, DAO, actual policy bond and raw integer amount", () => {
    const call = buildPaymentProposal(deployment, policy, "member1.test", payment);
    expect(call.receiverId).toBe(deployment.daoId);
    expect(call.deposit).toBe(policy.proposal_bond);
    expect(call.args).toEqual({ proposal: { description: payment.description, kind } });
  });
  it("does not turn supporter deposits into governance permission", () => {
    expect(() => buildPaymentProposal(deployment, policy, "alice.test", payment)).toThrow("permission");
    expect(() => buildProposalAction(deployment, policy, "alice.test", { id: 0, status: "InProgress", kind }, "VoteApprove")).toThrow("permission");
  });
  it("rejects decimal, overflow, negative and zero amounts", () => {
    for (const amount of ["1.5", "-1", "0", "01", (1n << 128n).toString()]) {
      expect(() => buildPaymentProposal(deployment, policy, "member1.test", { ...payment, amount })).toThrow();
    }
  });
  it("includes the exact fetched kind and prevents completed payment replay", () => {
    const call = buildProposalAction(deployment, policy, "member2.test", { id: 4, status: "InProgress", kind }, "VoteApprove");
    expect(call.args).toEqual({ id: 4, action: "VoteApprove", proposal: kind });
    for (const action of ["Finalize", "VoteApprove"] as const) {
      expect(() => buildProposalAction(deployment, policy, "member2.test", { id: 4, status: "Approved", kind }, action)).toThrow("not actionable");
    }
    expect(buildProposalAction(deployment, policy, "member2.test", { id: 4, status: "Failed", kind }, "Finalize").args.action).toBe("Finalize");
  });
});

/** Unsigned Sputnik transaction builders. No key custody, submission, or payment claims. */
export const SPUTNIK_REVISION = "5434a59dec23ee0c49df8c8c4350c208a7e75b0b";
export interface DaoPolicy {
  roles: Array<{
    name: string;
    kind: "Everyone" | { Group: string[] } | { Member: string };
    permissions: string[];
    vote_policy: Record<string, unknown>;
  }>;
  proposal_bond: string;
  proposal_period: string;
  default_vote_policy: {
    weight_kind: string;
    quorum: string;
    threshold: string | [number, number];
  };
}
export interface DaoDeployment { daoId: string; tokenId: string }
export interface TransferKind {
  Transfer: { token_id: string; receiver_id: string; amount: string; msg: null };
}
export interface UnsignedCall {
  receiverId: string;
  methodName: "add_proposal" | "act_proposal";
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}
const U128_MAX = (1n << 128n) - 1n;
function integer(value: string, allowZero = false): string {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 39) throw new Error("Invalid raw amount");
  const n = BigInt(value);
  if (n > U128_MAX || (!allowZero && n === 0n)) throw new Error("Amount out of range");
  return value;
}
function account(value: string): string {
  if (value.length < 2 || value.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)) {
    throw new Error("Invalid NEAR account");
  }
  return value;
}
function allowed(policy: DaoPolicy, actor: string, action: string): boolean {
  account(actor);
  return policy.roles.some(role => {
    const member = role.kind === "Everyone" || (typeof role.kind === "object" && "Group" in role.kind && role.kind.Group.includes(actor));
    return member && role.permissions.some(p => ["*:*", `transfer:*`, `*:${action}`, `transfer:${action}`].includes(p));
  });
}
/** Read the current policy from the selected DAO immediately before constructing a call. */
export function buildPaymentProposal(
  deployment: DaoDeployment, policy: DaoPolicy, actor: string,
  payment: { recipientId: string; amount: string; description: string },
): UnsignedCall {
  if (!allowed(policy, actor, "AddProposal")) throw new Error("Proposal permission required");
  if (!payment.description.trim() || payment.description.length > 500) throw new Error("Use a short payment description");
  const kind: TransferKind = { Transfer: {
    token_id: account(deployment.tokenId), receiver_id: account(payment.recipientId),
    amount: integer(payment.amount), msg: null,
  } };
  return {
    receiverId: account(deployment.daoId), methodName: "add_proposal",
    args: { proposal: { description: payment.description.trim(), kind } },
    deposit: integer(policy.proposal_bond, true), gas: "100000000000000",
  };
}
/** Include the exact fetched proposal kind: Sputnik rejects a changed recipient/amount. */
export function buildProposalAction(
  deployment: DaoDeployment, policy: DaoPolicy, actor: string,
  proposal: { id: number; status: string; kind: TransferKind },
  action: "VoteApprove" | "VoteReject" | "Finalize",
): UnsignedCall {
  if (!Number.isSafeInteger(proposal.id) || proposal.id < 0) throw new Error("Invalid proposal ID");
  if (!allowed(policy, actor, action)) throw new Error("Council permission required");
  if (action === "Finalize" ? proposal.status !== "Failed" : proposal.status !== "InProgress") {
    throw new Error("Proposal is not actionable");
  }
  if (proposal.kind.Transfer.token_id !== deployment.tokenId || proposal.kind.Transfer.msg !== null) throw new Error("Unsupported payment");
  account(proposal.kind.Transfer.receiver_id); integer(proposal.kind.Transfer.amount);
  return { receiverId: account(deployment.daoId), methodName: "act_proposal",
    args: { id: proposal.id, action, proposal: structuredClone(proposal.kind) }, deposit: "0", gas: "250000000000000" };
}

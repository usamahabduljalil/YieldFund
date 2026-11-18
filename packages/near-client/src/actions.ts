import { buildPaymentProposal, buildProposalAction } from "./index";
import {
  raw,
  account,
  requireThat,
  strategyMode,
  type Call,
  type Deployment,
  type Snapshot,
  type Operation,
  type Proposal,
} from "./chain";

export type Intent =
  | { kind: "register-token" | "register-position" | "checkpoint" | "redeem" }
  | { kind: "deposit" | "allocate" | "donate"; amount: string }
  | { kind: "withdraw"; amount: string; minimum: string }
  | { kind: "pause"; paused: boolean }
  | {
      kind: "advance" | "cancel" | "recover" | "continue-rhea";
      operation: Operation;
    }
  | { kind: "propose"; recipient: string; amount: string; description: string }
  | {
      kind: "vote";
      proposal: Proposal;
      action: "VoteApprove" | "VoteReject" | "Finalize";
    };
export function recoveryKind(
  o: Operation,
  disclosureVersion?: string,
  mode = "funded_simulator",
): "balance" | "redemption" | "payment" | "allocation" | null {
  if (
    mode === "funded_simulator" &&
    disclosureVersion === "factory-v2" &&
    o.kind === "allocation" &&
    ["allocating", "needs_reconciliation"].includes(o.stage)
  )
    return "allocation";
  if (
    mode === "funded_simulator" &&
    disclosureVersion === "factory-v2" &&
    o.stage === "transfer_pending" &&
    ["withdrawal", "donation"].includes(o.kind) &&
    BigInt(o.payout) > 0n
  )
    return "payment";
  if (
    o.stage === "reconciling" &&
    ["checkpoint", "withdrawal", "donation"].includes(o.kind) &&
    o.payout === "0"
  )
    return "balance";
  if (
    mode === "funded_simulator" &&
    o.kind === "redemption" &&
    ["redeeming", "needs_reconciliation"].includes(o.stage)
  )
    return "redemption";
  return null;
}
export function recoveryReadyAt(o: Operation): number {
  return Number(BigInt(raw(o.updated_at)) / 1_000_000n) + 300_000;
}
export function prepareCall(
  d: Deployment,
  s: Snapshot,
  actor: string,
  intent: Intent,
): Call {
  account(actor);
  requireThat(s.accountId === actor, "Account changed; reload balances");
  requireThat(
    Date.now() - s.fetchedAt < 30000 && Date.now() - s.timestamp < 120000,
    "Refresh before signing",
  );
  const c = d.config,
    a = s.accounting;
  requireThat(
    a.mode === strategyMode(d),
    "Strategy changed; reload deployment",
  );
  const call = (
    receiverId: string,
    methodName: string,
    args: Record<string, unknown>,
    deposit = "1",
    gas = "300000000000000",
  ): Call => ({ receiverId, methodName, args, deposit, gas });
  const guardian = () => requireThat(actor === c.guardian_id, "Guardian only");
  const idle = () =>
    requireThat(a.active_operation === null, "An operation needs settlement");
  const positive = (value: string) => {
    raw(value);
    requireThat(BigInt(value) > 0n, "Enter an amount greater than zero");
    return value;
  };
  switch (intent.kind) {
    case "register-token":
      requireThat(!s.tokenRegistered, "Already registered");
      return call(
        c.token_id,
        "storage_deposit",
        { account_id: actor, registration_only: true },
        s.tokenStorageCost,
      );
    case "register-position":
      requireThat(!s.position, "Already registered");
      return call(
        d.vaultId,
        "storage_deposit",
        { account_id: actor },
        s.costs.position,
      );
    case "deposit": {
      idle();
      requireThat(
        s.tokenRegistered && s.position && s.vaultRegistered,
        "Register token and position storage first",
      );
      requireThat(
        !a.paused && a.settled && a.shortfall === "0",
        "Deposits unavailable",
      );
      positive(intent.amount);
      requireThat(
        BigInt(intent.amount) <= BigInt(s.tokenBalance),
        "Insufficient token balance",
      );
      requireThat(
        BigInt(a.nominal) + BigInt(intent.amount) <= BigInt(c.deposit_cap),
        "Campaign cap exceeded",
      );
      return call(c.token_id, "ft_transfer_call", {
        receiver_id: d.vaultId,
        amount: intent.amount,
        msg: "deposit",
      });
    }
    case "withdraw": {
      idle();
      positive(intent.amount);
      raw(intent.minimum);
      requireThat(s.position, "Register a position first");
      requireThat(
        BigInt(intent.amount) <=
          BigInt(s.position.nominal) - BigInt(s.position.reserved),
        "Insufficient available units",
      );
      requireThat(
        BigInt(intent.minimum) <= BigInt(intent.amount),
        "Minimum exceeds claim",
      );
      return call(
        d.vaultId,
        "request_withdraw",
        { units: intent.amount, min_amount: intent.minimum },
        s.costs.operation,
      );
    }
    case "allocate":
      guardian();
      idle();
      positive(intent.amount);
      requireThat(
        !a.paused &&
          a.strategy_book === "0" &&
          BigInt(intent.amount) <= BigInt(a.cash),
        "Allocation unavailable",
      );
      return call(
        d.vaultId,
        "allocate_idle",
        { amount: intent.amount },
        s.costs.operation,
      );
    case "redeem":
      idle();
      requireThat(
        a.strategy_book !== "0" && !a.queued_redemption,
        "Advance the queued redemption or allocate first",
      );
      return call(d.vaultId, "redeem_strategy", {}, s.costs.operation);
    case "continue-rhea": {
      const o = intent.operation;
      requireThat(
        strategyMode(d) === "rhea_lending" &&
          a.active_operation === o.id &&
          a.queued_redemption === o.id &&
          o.kind === "redemption" &&
          o.stage === "redeeming" &&
          s.strategy.rhea &&
          ["Ready", "Reading"].includes(s.strategy.rhea.phase),
        "Rhea withdrawal outcome unresolved or operation changed",
      );
      return call(
        d.vaultId,
        "continue_rhea_redemption",
        { operation_id: raw(o.id), version: raw(o.version) },
        "1",
        "260000000000000",
      );
    }
    case "checkpoint":
      guardian();
      idle();
      requireThat(a.strategy_book === "0", "Redeem strategy first");
      return call(d.vaultId, "request_checkpoint", {}, s.costs.operation);
    case "donate":
      guardian();
      idle();
      positive(intent.amount);
      requireThat(
        !a.paused && a.settled && a.eligible_yield !== "0" && s.daoRegistered,
        "Yield settlement unavailable",
      );
      return call(
        d.vaultId,
        "distribute_yield",
        { max_amount: intent.amount },
        s.costs.operation,
      );
    case "pause":
      guardian();
      return call(d.vaultId, "set_paused", { paused: intent.paused });
    case "cancel": {
      const o = intent.operation;
      requireThat(
        o.owner_id === actor &&
          o.kind === "withdrawal" &&
          ["requested", "retryable_failure"].includes(o.stage),
        "Request cannot be cancelled",
      );
      return call(d.vaultId, "cancel_withdraw", { operation_id: raw(o.id) });
    }
    case "recover": {
      const o = intent.operation,
        kind = recoveryKind(o, d.config.disclosure_version, strategyMode(d));
      requireThat(
        a.active_operation === o.id && kind,
        "No automatic recovery for this stage",
      );
      requireThat(
        s.timestamp >= recoveryReadyAt(o),
        "Wait five minutes before recovery",
      );
      requireThat(
        kind === "redemption"
          ? a.queued_redemption === o.id
          : a.strategy_book === "0",
        "Recovery state changed",
      );
      return call(d.vaultId, "recover_operation", {
        operation_id: raw(o.id),
        version: raw(o.version),
      });
    }
    case "advance": {
      idle();
      const o = intent.operation;
      requireThat(
        ["requested", "retryable_failure"].includes(o.stage),
        "Operation cannot be retried",
      );
      requireThat(
        o.kind !== "allocation" &&
          (o.kind === "redemption"
            ? a.queued_redemption === o.id
            : a.strategy_book === "0"),
        "Redeem strategy before settlement",
      );
      return call(d.vaultId, "advance_operation", { operation_id: raw(o.id) });
    }
    case "propose":
      return buildPaymentProposal(
        { daoId: c.beneficiary_id, tokenId: c.token_id },
        s.policy,
        actor,
        {
          recipientId: intent.recipient,
          amount: positive(intent.amount),
          description: intent.description,
        },
      );
    case "vote": {
      requireThat(
        intent.action === "Finalize" || !intent.proposal.votes[actor],
        "Already voted",
      );
      return buildProposalAction(
        { daoId: c.beneficiary_id, tokenId: c.token_id },
        s.policy,
        actor,
        intent.proposal,
        intent.action,
      );
    }
  }
}

export interface Submission {
  id: string;
  scope: string;
  accountId: string;
  call: Call;
  createdAt: number;
  minHeight: number;
  hash?: string;
  state:
    | "awaiting-wallet"
    | "submitted"
    | "unknown"
    | "finalized"
    | "failed"
    | "attention";
  operationIds: string[];
  receiptIds: string[];
  error?: string;
  summary?: string;
  paymentConfirmed?: boolean;
}
export function isWalletRejection(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === 4001 || error.code === "USER_REJECTED")
  );
}
export function scope(d: Deployment) {
  return `${d.network}:${d.chainId}:${d.rpcUrl}:${d.vaultId}:${d.codeHashes[d.vaultId]}`;
}
/** Replace one campaign's rows without erasing another campaign's recovery history. */
export function persistSubmissions(
  storage: Pick<Storage, "getItem" | "setItem">,
  d: Deployment,
  next: Submission[],
) {
  const key = "yieldfund:chain-submissions:v1";
  const campaignScope = scope(d);
  requireThat(
    next.every((row) => row.scope === campaignScope),
    "Submission scope mismatch",
  );
  const saved: unknown = JSON.parse(storage.getItem(key) ?? "[]");
  requireThat(
    Array.isArray(saved),
    "Invalid saved activity. Export it before resetting.",
  );
  const others = saved.filter(
    (row: unknown) =>
      !row ||
      typeof row !== "object" ||
      !("scope" in row) ||
      row.scope !== campaignScope,
  );
  storage.setItem(key, JSON.stringify([...others, ...next]));
}
/** Storage entries contain public transaction parameters, never keys or signed payloads. */
export function restoreSubmissions(
  storage: Pick<Storage, "getItem">,
  d: Deployment,
): Submission[] {
  try {
    const rows = JSON.parse(
      storage.getItem("yieldfund:chain-submissions:v1") ?? "[]",
    );
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(
        (r: Submission) =>
          r.scope === scope(d) &&
          typeof r.id === "string" &&
          typeof r.accountId === "string" &&
          r.call &&
          Number.isSafeInteger(r.minHeight) &&
          Array.isArray(r.operationIds) &&
          Array.isArray(r.receiptIds),
      )
      .map((r: Submission) => ({
        ...r,
        state: r.hash
          ? "submitted"
          : r.state === "failed"
            ? "failed"
            : "unknown",
        summary: undefined,
        paymentConfirmed: false,
        receiptIds: [],
        operationIds: [],
        error: r.hash
          ? undefined
          : "Check wallet history before submitting again.",
      }));
  } catch {
    return [];
  }
}

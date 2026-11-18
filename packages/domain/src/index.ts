/** Integer reference model. LOCAL PREVIEW ONLY: this is not a custody contract. */
export const DECIMALS = 6;
export const SCALE = 10n ** BigInt(DECIMALS);
export const MAX_U128 = (1n << 128n) - 1n;
export const PREVIEW_ACCOUNT = "preview-supporter";
export const MEMBERS = ["Alex", "Sam", "Jo"] as const;

export function parseAmount(value: string, decimals = DECIMALS): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24)
    throw new Error("Invalid token precision.");
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals)
    throw new Error(
      `Use a positive amount with up to ${decimals} decimal places.`,
    );
  const amount =
    BigInt(match[1]) * 10n ** BigInt(decimals) +
    BigInt((match[2] ?? "").padEnd(decimals, "0") || "0");
  if (amount > MAX_U128) throw new Error("Amount is too large.");
  return amount;
}

export function formatAmount(
  amount: bigint,
  precision = 2,
  decimals = DECIMALS,
): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24)
    throw new Error("Invalid token precision.");
  const scale = 10n ** BigInt(decimals);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const integer = (absolute / scale)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rawFraction =
    decimals === 0 ? "" : (absolute % scale).toString().padStart(decimals, "0");
  const fraction = rawFraction.slice(
    0,
    Math.max(precision, rawFraction.replace(/0+$/, "").length),
  );
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}
export function inputAmount(amount: bigint): string {
  return `${amount / SCALE}.${(amount % SCALE).toString().padStart(DECIMALS, "0")}`;
}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function positive(amount: bigint) {
  requireThat(
    amount > 0n && amount <= MAX_U128,
    "Enter an amount greater than zero.",
  );
}
function checked(amount: bigint) {
  requireThat(
    amount >= 0n && amount <= MAX_U128,
    "Balance exceeds the supported range.",
  );
  return amount;
}

export type Withdrawal = {
  id: string;
  owner: string;
  units: bigint;
  minimum: bigint;
  status: "queued" | "processing" | "completed" | "cancelled";
  paid: bigint;
};
export type Operation = {
  id: string;
  kind: string;
  amount: bigint;
  status:
    | "completed"
    | "queued"
    | "failed"
    | "needs-reconciliation"
    | "pending"
    | "cancelled";
  detail: string;
  time: string;
};
export type Proposal = {
  id: string;
  title: string;
  recipient: string;
  amount: bigint;
  votes: string[];
  status: "voting" | "approved" | "paid" | "rejected";
};
export type Pending = {
  kind: "withdrawal" | "donation";
  operationId: string;
  requestId?: string;
  owner?: string;
  units: bigint;
  cash: bigint;
  uncertain: boolean;
};
export type Ledger = {
  version: number;
  idle: bigint;
  strategy: bigint;
  excluded: bigint;
  positions: Record<string, bigint>;
  wallet: bigint;
  treasury: bigint;
  donated: bigint;
  communityPaid: bigint;
  paidWithdrawals: bigint;
  totalDeposits: bigint;
  strategyResult: bigint;
  directTransfers: bigint;
  paused: boolean;
  liquidityBlocked: boolean;
  pending: Pending | null;
  withdrawals: Withdrawal[];
  operations: Operation[];
  proposals: Proposal[];
  nextId: number;
};
export function emptyLedger(): Ledger {
  return {
    version: 1,
    idle: 0n,
    strategy: 0n,
    excluded: 0n,
    positions: {},
    wallet: 10000n * SCALE,
    treasury: 0n,
    donated: 0n,
    communityPaid: 0n,
    paidWithdrawals: 0n,
    totalDeposits: 0n,
    strategyResult: 0n,
    directTransfers: 0n,
    paused: false,
    liquidityBlocked: false,
    pending: null,
    withdrawals: [],
    operations: [],
    proposals: [],
    nextId: 1,
  };
}
export function initialLedger(): Ledger {
  return {
    ...emptyLedger(),
    idle: 24000n * SCALE,
    strategy: 0n,
    positions: {
      "example-alex": 12000n * SCALE,
      "example-sam": 8000n * SCALE,
      "example-jo": 4000n * SCALE,
    },
    totalDeposits: 24000n * SCALE,
    strategyResult: 720n * SCALE,
    donated: 720n * SCALE,
    treasury: 720n * SCALE,
    operations: [
      {
        id: "example-funding",
        kind: "Treasury funded",
        amount: 720n * SCALE,
        status: "completed",
        detail: "Seeded example · local data, no chain receipt",
        time: "Example history",
      },
    ],
    proposals: [
      {
        id: "proposal-0",
        title: "Maintain the community SDK",
        recipient: "Example contributor",
        amount: 250n * SCALE,
        votes: ["Alex"],
        status: "voting",
      },
    ],
  };
}
export function accounting(s: Ledger) {
  const nominal = Object.values(s.positions).reduce((a, b) => a + b, 0n);
  const backing = s.idle + s.strategy - s.excluded;
  return {
    nominal,
    backing,
    supporterBacking: backing < nominal ? backing : nominal,
    surplus: backing > nominal ? backing - nominal : 0n,
    shortfall: nominal > backing ? nominal - backing : 0n,
    settled: s.strategy === 0n && s.pending === null,
  };
}
export function quoteWithdrawal(s: Ledger, units: bigint): bigint {
  const a = accounting(s);
  requireThat(
    units >= 0n && units <= a.nominal,
    "Requested units exceed the outstanding claim.",
  );
  if (a.nominal === 0n) return 0n;
  return (units * a.supporterBacking) / a.nominal;
}
export function availableUnits(s: Ledger, owner: string): bigint {
  return (
    (s.positions[owner] ?? 0n) -
    s.withdrawals
      .filter((w) => w.owner === owner && w.status === "queued")
      .reduce((a, w) => a + w.units, 0n)
  );
}
function assertNoPending(s: Ledger) {
  requireThat(!s.pending, "A transfer needs reconciliation before continuing.");
}
function assertSettled(s: Ledger) {
  assertNoPending(s);
  requireThat(s.strategy === 0n, "Redeem the strategy before settling.");
}
function record(
  s: Ledger,
  kind: string,
  amount: bigint,
  status: Operation["status"],
  detail: string,
): string {
  const id = `op-${s.nextId++}`;
  s.operations.unshift({
    id,
    kind,
    amount,
    status,
    detail,
    time: new Date().toISOString(),
  });
  return id;
}
export function assertInvariants(s: Ledger) {
  [
    s.idle,
    s.strategy,
    s.excluded,
    s.wallet,
    s.treasury,
    s.donated,
    s.communityPaid,
    s.paidWithdrawals,
    s.totalDeposits,
    ...Object.values(s.positions),
  ].forEach(checked);
  requireThat(s.excluded <= s.idle, "Excluded funds cannot exceed cash.");
  const reservedCash = s.pending?.cash ?? 0n;
  const lhs =
    s.idle + s.strategy + reservedCash + s.donated + s.paidWithdrawals;
  requireThat(
    lhs === s.totalDeposits + s.strategyResult + s.directTransfers,
    "Conservation check failed.",
  );
  requireThat(
    s.treasury + s.communityPaid === s.donated,
    "Treasury reconciliation failed.",
  );
  for (const owner of Object.keys(s.positions))
    requireThat(availableUnits(s, owner) >= 0n, "Units are reserved twice.");
}
export type Action =
  | { type: "deposit"; amount: bigint; owner: string }
  | { type: "allocate"; amount: bigint }
  | { type: "strategy-result"; amount: bigint }
  | { type: "direct-transfer"; amount: bigint }
  | { type: "checkpoint" }
  | {
      type: "request-withdrawal";
      owner: string;
      units: bigint;
      minimum: bigint;
    }
  | { type: "cancel-withdrawal"; owner: string; id: string }
  | { type: "begin-withdrawal"; id: string }
  | { type: "begin-donation"; amount: bigint }
  | { type: "resolve-transfer"; outcome: "success" | "failure" | "unknown" }
  | { type: "pause"; value: boolean }
  | { type: "liquidity"; value: boolean }
  | { type: "propose"; title: string; recipient: string; amount: bigint }
  | { type: "vote"; id: string; member: string }
  | { type: "pay-proposal"; id: string };

/** Immutable transitions; errors never partially mutate the caller's state. */
export function transition(previous: Ledger, action: Action): Ledger {
  const s: Ledger = structuredClone(previous);
  assertInvariants(s);
  switch (action.type) {
    case "deposit": {
      positive(action.amount);
      assertSettled(s);
      requireThat(!s.paused, "New deposits are paused.");
      requireThat(
        accounting(s).shortfall === 0n,
        "Deposits are unavailable while capital is impaired.",
      );
      requireThat(
        action.amount <= s.wallet,
        "Insufficient preview token balance.",
      );
      s.idle = checked(s.idle + action.amount);
      s.positions[action.owner] = checked(
        (s.positions[action.owner] ?? 0n) + action.amount,
      );
      s.totalDeposits = checked(s.totalDeposits + action.amount);
      s.wallet -= action.amount;
      record(
        s,
        "Deposit accepted",
        action.amount,
        "completed",
        "Accepted as idle capital. Local preview only.",
      );
      break;
    }
    case "allocate": {
      positive(action.amount);
      assertNoPending(s);
      requireThat(!s.paused, "New allocation is paused.");
      requireThat(
        accounting(s).shortfall === 0n,
        "Allocation is unavailable while capital is impaired.",
      );
      requireThat(
        action.amount <= s.idle - s.excluded,
        "Insufficient unreserved cash.",
      );
      s.idle -= action.amount;
      s.strategy = checked(s.strategy + action.amount);
      record(
        s,
        "Capital allocated",
        action.amount,
        "completed",
        "Simulated allocation; no lending transaction.",
      );
      break;
    }
    case "strategy-result": {
      assertNoPending(s);
      requireThat(
        s.strategy > 0n,
        "Allocate capital before simulating a strategy result.",
      );
      s.strategy = checked(s.strategy + action.amount);
      s.strategyResult += action.amount;
      record(
        s,
        action.amount < 0n ? "Strategy loss" : "Strategy gain",
        action.amount < 0n ? -action.amount : action.amount,
        "completed",
        "Local scenario; no real tokens moved.",
      );
      break;
    }
    case "direct-transfer": {
      positive(action.amount);
      assertNoPending(s);
      s.idle = checked(s.idle + action.amount);
      s.excluded = checked(s.excluded + action.amount);
      s.directTransfers += action.amount;
      break;
    }
    case "checkpoint": {
      assertNoPending(s);
      requireThat(
        !s.liquidityBlocked,
        "Strategy liquidity is unavailable. Withdrawals stay queued.",
      );
      const redeemed = s.strategy;
      s.idle = checked(s.idle + redeemed);
      s.strategy = 0n;
      record(
        s,
        "Checkpoint settled",
        redeemed,
        "completed",
        "Preview strategy redeemed and ledger reconciled.",
      );
      break;
    }
    case "request-withdrawal": {
      positive(action.units);
      requireThat(
        action.minimum >= 0n && action.minimum <= MAX_U128,
        "Invalid minimum payout.",
      );
      requireThat(
        action.units <= availableUnits(s, action.owner),
        "Requested units exceed your available position.",
      );
      const id = record(
        s,
        "Withdrawal requested",
        action.units,
        "queued",
        "Awaiting full redemption and settlement.",
      );
      s.withdrawals.push({
        id,
        owner: action.owner,
        units: action.units,
        minimum: action.minimum,
        status: "queued",
        paid: 0n,
      });
      break;
    }
    case "cancel-withdrawal": {
      const w = s.withdrawals.find((x) => x.id === action.id);
      requireThat(
        w && w.owner === action.owner && w.status === "queued",
        "Only an owned queued request can be cancelled.",
      );
      w.status = "cancelled";
      const op = s.operations.find((x) => x.id === w.id)!;
      op.status = "cancelled";
      break;
    }
    case "begin-withdrawal": {
      assertSettled(s);
      const w = s.withdrawals.find((x) => x.id === action.id);
      requireThat(w && w.status === "queued", "Request is not queued.");
      const cash = quoteWithdrawal(s, w.units);
      requireThat(
        cash >= w.minimum,
        "Payout is below your minimum. Cancel and request a new minimum to continue.",
      );
      requireThat(
        cash > 0n,
        "Payout rounds to zero. Request more units or wait for recovery.",
      );
      s.positions[w.owner] -= w.units;
      s.idle -= cash;
      w.status = "processing";
      const operationId = record(
        s,
        "Withdrawal transfer",
        cash,
        "pending",
        "Cash and units reserved.",
      );
      s.pending = {
        kind: "withdrawal",
        operationId,
        requestId: w.id,
        owner: w.owner,
        units: w.units,
        cash,
        uncertain: false,
      };
      break;
    }
    case "begin-donation": {
      positive(action.amount);
      assertSettled(s);
      requireThat(!s.paused, "Yield distribution is paused.");
      requireThat(
        action.amount <= accounting(s).surplus &&
          action.amount <= s.idle - s.excluded,
        "Only eligible realized surplus can be donated.",
      );
      s.idle -= action.amount;
      const operationId = record(
        s,
        "Yield donation",
        action.amount,
        "pending",
        "Reserved for the fixed example treasury.",
      );
      s.pending = {
        kind: "donation",
        operationId,
        units: 0n,
        cash: action.amount,
        uncertain: false,
      };
      break;
    }
    case "resolve-transfer": {
      const p = s.pending;
      requireThat(p, "No pending transfer.");
      const op = s.operations.find((x) => x.id === p.operationId)!;
      if (action.outcome === "unknown") {
        p.uncertain = true;
        op.status = "needs-reconciliation";
        op.detail = "Outcome unknown. Conflicting actions remain locked.";
        break;
      }
      const w = s.withdrawals.find((x) => x.id === p.requestId);
      if (action.outcome === "failure") {
        s.idle += p.cash;
        if (w && p.owner) {
          s.positions[p.owner] += p.units;
          w.status = "queued";
        }
        op.status = "failed";
        op.detail = "Confirmed failure. Reservations restored once.";
      } else {
        if (p.kind === "donation") {
          s.donated += p.cash;
          s.treasury += p.cash;
        } else {
          s.paidWithdrawals += p.cash;
          if (p.owner === PREVIEW_ACCOUNT) s.wallet += p.cash;
          if (w) {
            w.status = "completed";
            w.paid = p.cash;
            s.operations.find((x) => x.id === w.id)!.status = "completed";
          }
        }
        op.status = "completed";
        op.detail = "Completed in local preview. No on-chain receipt.";
      }
      s.pending = null;
      break;
    }
    case "pause":
      s.paused = action.value;
      break;
    case "liquidity":
      s.liquidityBlocked = action.value;
      break;
    case "propose": {
      positive(action.amount);
      requireThat(
        action.title.trim().length >= 3 && action.title.length <= 100,
        "Enter a title between 3 and 100 characters.",
      );
      requireThat(
        action.recipient.trim().length >= 2 && action.recipient.length <= 64,
        "Enter a recipient name.",
      );
      s.proposals.push({
        id: `proposal-${s.nextId++}`,
        title: action.title.trim(),
        recipient: action.recipient.trim(),
        amount: action.amount,
        votes: [],
        status: "voting",
      });
      break;
    }
    case "vote": {
      const p = s.proposals.find((x) => x.id === action.id);
      requireThat(
        p && p.status === "voting",
        "Proposal is not open for voting.",
      );
      requireThat(
        MEMBERS.includes(action.member as (typeof MEMBERS)[number]),
        "Only an example council member can vote.",
      );
      requireThat(
        !p.votes.includes(action.member),
        "This member has already voted.",
      );
      p.votes.push(action.member);
      if (p.votes.length >= 2) p.status = "approved";
      break;
    }
    case "pay-proposal": {
      const p = s.proposals.find((x) => x.id === action.id);
      requireThat(p && p.status === "approved", "Two approvals are required.");
      requireThat(
        p.amount <= s.treasury,
        "The treasury has insufficient donated funds.",
      );
      s.treasury -= p.amount;
      s.communityPaid += p.amount;
      p.status = "paid";
      record(
        s,
        "Community payment",
        p.amount,
        "completed",
        `Example recipient: ${p.recipient}. Local governance preview only.`,
      );
      break;
    }
  }
  s.version++;
  assertInvariants(s);
  return s;
}

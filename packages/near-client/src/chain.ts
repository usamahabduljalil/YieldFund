import type { DaoPolicy, TransferKind } from "./index";
import { publicReadTransport } from "./read-transport.ts";

export interface VaultConfig {
  campaign_id: string;
  token_id: string;
  token_decimals: number;
  beneficiary_id: string;
  guardian_id: string;
  deposit_cap: string;
  metadata_hash: string;
  disclosure_version: string;
  strategy_id: string;
  rhea_extra_decimals?: number;
}
export interface Deployment {
  displayName?: string;
  mode: "chain";
  network: "mainnet" | "testnet" | "sandbox";
  strategyMode?: "funded_simulator" | "rhea_lending";
  tokenSymbol?: string;
  chainId: string;
  rpcUrl: string;
  vaultId: string;
  config: VaultConfig;
  codeHashes: Record<string, string>;
  daoPolicy: DaoPolicy;
  factoryInfo: { factory_id: string; auto_update: boolean };
  transactionsEnabled: boolean;
  authority: string;
}
export type RuntimeConfig = { mode: "preview" } | Deployment;
export interface Position {
  nominal: string;
  reserved: string;
  deposited: string;
  withdrawn: string;
}
export interface Accounting {
  mode: string;
  cash: string;
  excluded: string;
  nominal: string;
  backing: string;
  shortfall: string;
  eligible_yield: string;
  strategy_book: string;
  donated: string;
  reserved_outbound: string;
  settled: boolean;
  paused: boolean;
  needs_reconciliation: boolean;
  active_operation: string | null;
  queued_redemption: string | null;
  checkpoint_at: string;
  state_version: string;
}
export interface Operation {
  id: string;
  kind: string;
  owner_id: string;
  units: string;
  minimum: string;
  payout: string;
  stage: string;
  version: string;
  started_at: string;
  updated_at: string;
  error: string | null;
}
export interface Proposal {
  id: number;
  description: string;
  status: string;
  kind: TransferKind;
  votes: Record<string, string>;
}
export interface Snapshot {
  blockHash: string;
  height: number;
  timestamp: number;
  fetchedAt: number;
  accountId: string;
  accounting: Accounting;
  operations: Operation[];
  proposals: Proposal[];
  proposalCount: number;
  policy: DaoPolicy;
  position: Position | null;
  tokenBalance: string;
  treasuryBalance: string;
  tokenRegistered: boolean;
  vaultRegistered: boolean;
  daoRegistered: boolean;
  costs: { position: string; operation: string };
  tokenStorageCost: string;
  strategy: { position: string; busy: boolean; rhea?: RheaStatus };
  nativeBalance: string;
}
export interface RheaStatus {
  phase: "Idle" | "Reading" | "Ready" | "Withdrawing" | "Unknown";
  pending_raw_amount: string;
  position_owner: string;
  protocol_id: string;
  extra_decimals: number;
}
export const strategyMode = (d: Deployment) =>
  d.strategyMode ?? "funded_simulator";
export const tokenSymbol = (d: Deployment) => d.tokenSymbol ?? "tUSD";
export function isTokenPayment(p: Proposal, tokenId: string): boolean {
  return (
    !!p?.kind?.Transfer &&
    p.kind.Transfer.token_id === tokenId &&
    p.kind.Transfer.msg === null
  );
}
export interface Call {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}
export interface Outcome {
  id: string;
  block_hash: string;
  outcome: {
    executor_id: string;
    logs: string[];
    receipt_ids: string[];
    status: Record<string, unknown>;
  };
}
export interface Transaction {
  final_execution_status: string;
  status: Record<string, unknown>;
  transaction: {
    hash: string;
    signer_id: string;
    receiver_id: string;
    actions: Array<{
      FunctionCall?: {
        method_name: string;
        args: string;
        deposit: string;
        gas: number | string;
      };
    }>;
  };
  transaction_outcome: Outcome;
  receipts_outcome: Outcome[];
}
export function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function raw(value: unknown): string {
  requireThat(
    typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/.test(value),
    "Invalid integer response",
  );
  requireThat(BigInt(value) <= (1n << 128n) - 1n, "Integer exceeds u128");
  return value;
}
export function account(value: unknown): string {
  requireThat(
    typeof value === "string" &&
      value.length >= 2 &&
      value.length <= 64 &&
      /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value),
    "Invalid account ID",
  );
  return value;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function normalizedPolicy(policy: DaoPolicy): string {
  return canonical({
    ...policy,
    roles: policy.roles
      .map((r) => ({
        ...r,
        kind:
          typeof r.kind === "object" && "Group" in r.kind
            ? { Group: [...r.kind.Group].sort() }
            : r.kind,
        permissions: [...r.permissions].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
}
export function parseDeployment(value: unknown): RuntimeConfig {
  requireThat(
    value && typeof value === "object",
    "Invalid deployment configuration",
  );
  const d = value as Deployment;
  if ((value as { mode: string }).mode === "preview")
    return { mode: "preview" };
  requireThat(
    d.mode === "chain" && ["mainnet", "testnet", "sandbox"].includes(d.network),
    "Unsupported network",
  );
  const url = new URL(d.rpcUrl);
  requireThat(
    !url.username && !url.password && !url.hash,
    "RPC URL must not contain credentials",
  );
  requireThat(
    d.network !== "sandbox"
      ? url.protocol === "https:" && d.chainId === d.network
      : ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          url.protocol === "http:" &&
          !!d.chainId,
    "Invalid network/RPC configuration",
  );
  requireThat(
    typeof d.transactionsEnabled === "boolean" &&
      (d.network === "testnet" || !d.transactionsEnabled),
    "Mainnet and Sandbox browser signing await release acceptance",
  );
  const c = d.config;
  requireThat(
    c &&
      /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(c.campaign_id) &&
      Number.isInteger(c.token_decimals) &&
      c.token_decimals >= 0 &&
      c.token_decimals <= 24 &&
      !!c.disclosure_version,
    "Unsupported campaign configuration",
  );
  const rhea = strategyMode(d) === "rhea_lending";
  requireThat(
    ["funded_simulator", "rhea_lending"].includes(strategyMode(d)),
    "Unsupported strategy mode",
  );
  requireThat(
    d.network !== "mainnet" || rhea,
    "Mainnet requires Rhea integration",
  );
  requireThat(
    d.network !== "mainnet" || c.strategy_id === "contract.main.burrow.near",
    "Unexpected mainnet Rhea contract",
  );
  requireThat(
    rhea
      ? Number.isInteger(c.rhea_extra_decimals) &&
          c.rhea_extra_decimals! >= 0 &&
          c.rhea_extra_decimals! <= 24 &&
          typeof d.tokenSymbol === "string" &&
          /^[A-Za-z0-9._-]{1,24}$/.test(d.tokenSymbol)
      : c.rhea_extra_decimals === undefined &&
          c.token_decimals === 6 &&
          tokenSymbol(d) === "tUSD",
    "Unsupported token/strategy configuration",
  );
  const ids = [d.vaultId, c.token_id, c.strategy_id, c.beneficiary_id].map(
    account,
  );
  requireThat(new Set(ids).size === 4, "Contracts must have distinct accounts");
  account(c.guardian_id);
  raw(c.deposit_cap);
  for (const id of ids)
    requireThat(
      /^[0-9a-f]{64}$/.test(d.codeHashes?.[id] ?? ""),
      `Missing SHA-256 for ${id}`,
    );
  requireThat(
    d.daoPolicy?.roles?.length > 0 &&
      !!d.factoryInfo &&
      typeof d.authority === "string" &&
      d.authority.length > 0,
    "Missing DAO policy or authority disclosure",
  );
  raw(d.daoPolicy.proposal_bond);
  raw(d.daoPolicy.proposal_period);
  const council = d.daoPolicy.roles[0];
  const members =
    typeof council.kind === "object" && "Group" in council.kind
      ? council.kind.Group
      : [];
  if (!rhea)
    requireThat(
      d.daoPolicy.roles.length === 1 &&
        new Set(members).size === 3 &&
        members.length === 3 &&
        d.daoPolicy.default_vote_policy.weight_kind === "RoleWeight" &&
        d.daoPolicy.default_vote_policy.threshold === "2" &&
        d.daoPolicy.default_vote_policy.quorum === "2" &&
        Object.keys(council.vote_policy).length === 0 &&
        canonical([...council.permissions].sort()) ===
          canonical(
            [
              "transfer:AddProposal",
              "transfer:Finalize",
              "transfer:VoteApprove",
              "transfer:VoteReject",
            ].sort(),
          ),
      "Unsupported DAO policy: require the three-member, two-vote transfer-only council",
    );
  members.forEach(account);
  return d;
}
export function base58HashHex(hash: string): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const char of hash) {
    const i = alphabet.indexOf(char);
    requireThat(i >= 0, "Invalid code hash");
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16).padStart(64, "0");
  requireThat(hex.length === 64, "Invalid hash length");
  return hex;
}
/** Hash-addressed global contracts pin immutable code just like local code.
 * Account-addressed globals need an additional provider binding/read and are
 * deliberately rejected until the manifest can record that authority.
 */
export function accountCodeHash(value: {
  code_hash: string;
  global_contract_hash?: string;
  global_contract_account_id?: string;
}): string {
  requireThat(
    !value.global_contract_account_id,
    "Account-linked global code requires a reviewed provider binding",
  );
  if (value.global_contract_hash) {
    requireThat(
      base58HashHex(value.code_hash) === "0".repeat(64),
      "Ambiguous contract code identity",
    );
    return base58HashHex(value.global_contract_hash);
  }
  return base58HashHex(value.code_hash);
}
const encode = (v: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));
export function decode(value: string): unknown {
  return JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
    ),
  );
}

export class ChainClient {
  readonly deployment: Deployment;
  private transport: typeof fetch;
  private snapshots = new Map<string, Promise<Snapshot>>();
  constructor(
    deployment: Deployment,
    transport: typeof fetch = publicReadTransport,
  ) {
    this.deployment = deployment;
    this.transport = transport;
  }
  async rpc<T>(method: string, params: object): Promise<T> {
    const response = await this.transport(this.deployment.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "yieldfund", method, params }),
      signal: AbortSignal.timeout(15000),
    });
    requireThat(response.ok, `RPC unavailable (${response.status})`);
    const body = await response.json();
    requireThat(
      !body.error,
      `RPC ${method} failed: ${body.error?.cause?.name ?? body.error?.message ?? "unknown error"}`,
    );
    requireThat("result" in body, "Missing RPC result");
    return body.result;
  }
  async view<T>(
    id: string,
    method: string,
    args: object = {},
    block?: string,
  ): Promise<T> {
    const result = await this.rpc<{ result: number[] }>("query", {
      request_type: "call_function",
      account_id: id,
      method_name: method,
      args_base64: encode(args),
      ...(block ? { block_id: block } : { finality: "final" }),
    });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
  }
  snapshot(accountId = ""): Promise<Snapshot> {
    const existing = this.snapshots.get(accountId);
    if (existing) return existing;
    const pending = this.loadSnapshot(accountId).finally(() => {
      if (this.snapshots.get(accountId) === pending)
        this.snapshots.delete(accountId);
    });
    this.snapshots.set(accountId, pending);
    return pending;
  }
  private async readStrategy(block: string): Promise<Snapshot["strategy"]> {
    const d = this.deployment,
      c = d.config;
    if (strategyMode(d) !== "rhea_lending") {
      const value = await this.view<
        Snapshot["strategy"] & {
          vault_id: string;
          token_id: string;
          mode: string;
        }
      >(c.strategy_id, "get_position", {}, block);
      requireThat(
        value.token_id === c.token_id &&
          value.vault_id === d.vaultId &&
          value.mode === "funded_simulator",
        "Strategy binding differs",
      );
      return value;
    }
    type Asset = { token_id: string; balance: string };
    const [status, position, asset] = await Promise.all([
      this.view<RheaStatus>(d.vaultId, "get_rhea_status", {}, block),
      this.view<{
        account_id: string;
        supplied: Asset[];
        positions: Record<string, { collateral: Asset[]; borrowed: Asset[] }>;
        is_locked: boolean;
      } | null>(
        c.strategy_id,
        "get_account_all_positions",
        { account_id: d.vaultId },
        block,
      ),
      this.view<{
        token_id: string;
        config: { extra_decimals: number; can_withdraw: boolean };
      } | null>(c.strategy_id, "get_asset", { token_id: c.token_id }, block),
    ]);
    requireThat(
      status.position_owner === d.vaultId &&
        status.protocol_id === c.strategy_id &&
        status.extra_decimals === c.rhea_extra_decimals &&
        ["Idle", "Reading", "Ready", "Withdrawing", "Unknown"].includes(
          status.phase,
        ),
      "Rhea vault binding differs",
    );
    raw(status.pending_raw_amount);
    requireThat(
      asset?.token_id === c.token_id &&
        asset.config.extra_decimals === c.rhea_extra_decimals &&
        typeof asset.config.can_withdraw === "boolean",
      "Rhea asset precision/binding changed",
    );
    if (position) {
      requireThat(
        position.account_id === d.vaultId &&
          Array.isArray(position.supplied) &&
          position.supplied.length <= 1 &&
          position.supplied.every((a) => a.token_id === c.token_id) &&
          position.positions &&
          Object.values(position.positions).every(
            (p) =>
              Array.isArray(p.borrowed) &&
              !p.borrowed.length &&
              Array.isArray(p.collateral) &&
              !p.collateral.length,
          ) &&
          typeof position.is_locked === "boolean",
        "Unexpected Rhea position or borrowing",
      );
    }
    const balance = position?.supplied[0]?.balance ?? "0";
    return {
      position: (
        BigInt(raw(balance)) /
        10n ** BigInt(c.rhea_extra_decimals!)
      ).toString(),
      busy: !!position?.is_locked || status.phase !== "Idle",
      rhea: status,
    };
  }
  private async loadSnapshot(accountId: string): Promise<Snapshot> {
    const d = this.deployment,
      c = d.config;
    const status = await this.rpc<{
      chain_id: string;
      sync_info: { syncing: boolean };
    }>("status", {});
    requireThat(
      status.chain_id === d.chainId && !status.sync_info.syncing,
      "Wrong network or RPC is syncing",
    );
    const { header } = await this.rpc<{
      header: { hash: string; height: number; timestamp_nanosec: string };
    }>("block", { finality: "final" });
    const block = header.hash,
      timestamp = Number(BigInt(header.timestamp_nanosec) / 1_000_000n);
    requireThat(
      Date.now() - timestamp < 120000 && timestamp - Date.now() < 30000,
      "Finalized network data is stale",
    );
    const [
      config,
      policy,
      factory,
      metadata,
      strategy,
      accounting,
      operations,
      costs,
      bounds,
      treasuryBalance,
      vaultStorage,
      daoStorage,
      proposalCount,
    ] = await Promise.all([
      this.view<VaultConfig>(d.vaultId, "get_config", {}, block),
      this.view<DaoPolicy>(c.beneficiary_id, "get_policy", {}, block),
      this.view<Deployment["factoryInfo"]>(
        c.beneficiary_id,
        "get_factory_info",
        {},
        block,
      ),
      this.view<{ decimals: number; symbol: string }>(
        c.token_id,
        "ft_metadata",
        {},
        block,
      ),
      this.readStrategy(block),
      this.view<Accounting>(d.vaultId, "get_accounting", {}, block),
      this.view<Operation[]>(
        d.vaultId,
        "get_operations",
        { from_id: "1", limit: 50 },
        block,
      ),
      this.view<Snapshot["costs"]>(d.vaultId, "storage_costs", {}, block),
      this.view<{ min: string }>(
        c.token_id,
        "storage_balance_bounds",
        {},
        block,
      ),
      this.view<string>(
        c.token_id,
        "ft_balance_of",
        { account_id: c.beneficiary_id },
        block,
      ),
      this.view<unknown>(
        c.token_id,
        "storage_balance_of",
        { account_id: d.vaultId },
        block,
      ),
      this.view<unknown>(
        c.token_id,
        "storage_balance_of",
        { account_id: c.beneficiary_id },
        block,
      ),
      this.view<number>(c.beneficiary_id, "get_last_proposal_id", {}, block),
      ...Object.entries(d.codeHashes).map(async ([id, expected]) => {
        const a = await this.rpc<{
          code_hash: string;
          global_contract_hash?: string;
          global_contract_account_id?: string;
        }>("query", {
          request_type: "view_account",
          account_id: id,
          block_id: block,
        });
        requireThat(
          accountCodeHash(a) === expected,
          `Contract code changed: ${id}`,
        );
      }),
    ]);
    requireThat(
      canonical(config) === canonical(c),
      "Vault configuration differs from deployment",
    );
    requireThat(
      normalizedPolicy(policy) === normalizedPolicy(d.daoPolicy),
      "DAO policy changed; review deployment",
    );
    requireThat(
      canonical(factory) === canonical(d.factoryInfo),
      "DAO upgrade authority changed",
    );
    requireThat(
      metadata.decimals === c.token_decimals &&
        metadata.symbol === tokenSymbol(d),
      "Unexpected token metadata",
    );
    requireThat(
      accounting.mode === strategyMode(d),
      "Unexpected strategy mode",
    );
    for (const key of [
      "cash",
      "excluded",
      "nominal",
      "backing",
      "shortfall",
      "eligible_yield",
      "strategy_book",
      "donated",
      "reserved_outbound",
      "checkpoint_at",
      "state_version",
    ] as const)
      raw(accounting[key]);
    raw(costs.position);
    raw(costs.operation);
    raw(bounds.min);
    raw(treasuryBalance);
    raw(strategy.position);
    requireThat(
      Array.isArray(operations) &&
        Number.isSafeInteger(proposalCount) &&
        proposalCount >= 0,
      "Invalid history response",
    );
    const [position, tokenBalance, registered, native, proposals] =
      await Promise.all([
        accountId
          ? this.view<Position | null>(
              d.vaultId,
              "get_position",
              { account_id: account(accountId) },
              block,
            )
          : null,
        accountId
          ? this.view<string>(
              c.token_id,
              "ft_balance_of",
              { account_id: accountId },
              block,
            )
          : "0",
        accountId
          ? this.view<unknown>(
              c.token_id,
              "storage_balance_of",
              { account_id: accountId },
              block,
            )
          : null,
        accountId
          ? this.rpc<{ amount: string }>("query", {
              request_type: "view_account",
              account_id: accountId,
              block_id: block,
            })
          : { amount: "0" },
        this.view<Proposal[]>(
          c.beneficiary_id,
          "get_proposals",
          { from_index: Math.max(0, proposalCount - 50), limit: 50 },
          block,
        ),
      ]);
    if (position) Object.values(position).forEach(raw);
    raw(tokenBalance);
    raw(native.amount);
    return {
      blockHash: block,
      height: header.height,
      timestamp,
      fetchedAt: Date.now(),
      accountId,
      accounting,
      operations,
      proposals: proposals.filter((p) => isTokenPayment(p, c.token_id)),
      proposalCount,
      policy,
      position,
      tokenBalance,
      treasuryBalance,
      tokenRegistered: !!registered,
      vaultRegistered: !!vaultStorage,
      daoRegistered: !!daoStorage,
      costs,
      tokenStorageCost: bounds.min,
      strategy,
      nativeBalance: native.amount,
    };
  }
  async checkFunding(s: Snapshot, call: Call): Promise<void> {
    requireThat(s.accountId, "Connect your wallet first");
    const [native, protocol, price] = await Promise.all([
      this.rpc<{ amount: string; storage_usage: number }>("query", {
        request_type: "view_account",
        account_id: account(s.accountId),
        block_id: s.blockHash,
      }),
      this.rpc<{ runtime_config: { storage_amount_per_byte: string } }>(
        "EXPERIMENTAL_protocol_config",
        { block_id: s.blockHash },
      ),
      this.rpc<{ gas_price: string }>("gas_price", [s.blockHash]),
    ]);
    requireThat(
      Number.isSafeInteger(native.storage_usage) && native.storage_usage >= 0,
      "Invalid storage usage",
    );
    const storage =
      BigInt(native.storage_usage) *
      BigInt(raw(protocol.runtime_config.storage_amount_per_byte));
    // Conservative preflight, not a fee quote: retain account storage and a
    // 10x gas-price admission reserve plus 5 Tgas overhead. Testnet rejected
    // a 300 Tgas creation despite sufficient balance for the old 2x estimate.
    // This is temporary available balance, not the expected burned fee. Wallet and
    // network still enforce actual fees and access-key allowance at signing.
    const gas =
      (BigInt(raw(call.gas)) + 5_000_000_000_000n) *
      BigInt(raw(price.gas_price)) *
      10n;
    requireThat(
      BigInt(raw(native.amount)) >= storage + gas + BigInt(raw(call.deposit)),
      "Insufficient available NEAR for storage, deposit and gas buffer",
    );
  }
  operation(id: string) {
    return this.view<Operation | null>(
      this.deployment.vaultId,
      "get_operation",
      { operation_id: raw(id) },
    );
  }
  async proposal(id: number) {
    requireThat(Number.isSafeInteger(id) && id >= 0, "Invalid proposal ID");
    const proposal = await this.view<Proposal>(
      this.deployment.config.beneficiary_id,
      "get_proposal",
      { id },
    );
    requireThat(
      isTokenPayment(proposal, this.deployment.config.token_id),
      "This is not a payment of the campaign token. Open the proposal in Trezu.",
    );
    return proposal;
  }
  async transaction(hash: string, sender: string) {
    requireThat(
      /^[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(hash),
      "Invalid transaction hash",
    );
    const status = await this.rpc<{ chain_id: string }>("status", {});
    requireThat(
      status.chain_id === this.deployment.chainId,
      "Wrong receipt network",
    );
    return this.rpc<Transaction>("tx", {
      tx_hash: hash,
      sender_account_id: account(sender),
      wait_until: "FINAL",
    });
  }
}

export interface ReceiptCheck {
  status: "pending" | "failed" | "finalized" | "attention";
  operations: string[];
  transfers: Array<{
    receiptId: string;
    from: string;
    to: string;
    amount: string;
  }>;
  receiptIds: string[];
  summary?: string;
  paymentConfirmed?: boolean;
}
/** Only trust RPC-refetched final outcomes linked to the transaction root. Wallet returns are hints. */
export function inspectTransaction(
  tx: Transaction,
  hash: string,
  sender: string,
  call: Call,
  d: Deployment,
): ReceiptCheck {
  requireThat(
    tx.transaction.hash === hash &&
      tx.transaction.signer_id === sender &&
      tx.transaction.receiver_id === call.receiverId,
    "Transaction identity mismatch",
  );
  const actions = tx.transaction.actions;
  requireThat(
    actions.length === 1 &&
      actions[0].FunctionCall?.method_name === call.methodName,
    "Unexpected transaction action",
  );
  const action = actions[0].FunctionCall!;
  requireThat(
    action.deposit === call.deposit &&
      String(action.gas) === call.gas &&
      canonical(decode(action.args)) === canonical(call.args),
    "Signed parameters differ from review",
  );
  const result: ReceiptCheck = {
    status: "pending",
    operations: [],
    transfers: [],
    receiptIds: [],
  };
  if (tx.final_execution_status !== "FINAL") return result;
  const byId = new Map(tx.receipts_outcome.map((o) => [o.id, o]));
  const queue = [tx.transaction_outcome];
  const seen = new Set<string>();
  let failed = false;
  while (queue.length) {
    const o = queue.shift()!;
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    result.receiptIds.push(o.id);
    if ("Failure" in o.outcome.status) failed = true;
    for (const id of o.outcome.receipt_ids) {
      const child = byId.get(id);
      requireThat(child, "Incomplete finalized receipt tree");
      queue.push(child);
    }
    if ("Failure" in o.outcome.status) continue;
    for (const line of o.outcome.logs) {
      if (!line.startsWith("EVENT_JSON:")) continue;
      let event;
      try {
        event = JSON.parse(line.slice(11));
      } catch {
        continue;
      }
      if (!Array.isArray(event.data)) continue;
      if (
        o.outcome.executor_id === d.vaultId &&
        event.standard === "yieldfund" &&
        event.version === "1.0.0"
      ) {
        for (const item of event.data)
          if (
            item.operation_id &&
            item.campaign_id === d.config.campaign_id &&
            item.token_id === d.config.token_id
          )
            result.operations.push(raw(item.operation_id));
      }
      if (
        o.outcome.executor_id === d.config.token_id &&
        event.standard === "nep141" &&
        event.event === "ft_transfer"
      ) {
        for (const item of event.data)
          result.transfers.push({
            receiptId: o.id,
            from: account(item.old_owner_id),
            to: account(item.new_owner_id),
            amount: raw(item.amount),
          });
      }
    }
  }
  result.operations = [...new Set(result.operations)];
  result.status =
    "Failure" in tx.status ? "failed" : failed ? "attention" : "finalized";
  if (
    call.methodName === "ft_transfer_call" &&
    call.receiverId === d.config.token_id &&
    call.args.msg === "deposit" &&
    typeof tx.status.SuccessValue === "string"
  ) {
    const used = raw(decode(tx.status.SuccessValue));
    result.summary =
      used === call.args.amount
        ? "Deposit accepted"
        : used === "0"
          ? "Deposit refunded"
          : "Partial deposit; inspect receipts";
  }
  if (call.methodName === "act_proposal") {
    const kind = call.args.proposal as TransferKind;
    result.paymentConfirmed =
      !!kind?.Transfer &&
      result.transfers.some(
        (t) =>
          t.from === d.config.beneficiary_id &&
          t.to === kind.Transfer.receiver_id &&
          t.amount === kind.Transfer.amount,
      );
    if (result.paymentConfirmed)
      result.summary = "DAO token transfer confirmed";
  }
  return result;
}

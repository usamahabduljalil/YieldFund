import {
  account,
  base58HashHex,
  canonical,
  raw,
  requireThat,
  type Call,
  type Deployment,
  type VaultConfig,
  parseDeployment,
  decode,
  canonical as canonicalValue,
} from "./chain";
import { publicReadTransport } from "./read-transport";
import type { DaoPolicy } from "./index";

export interface RegistryDeployment {
  network: "testnet" | "mainnet" | "sandbox";
  chainId: string;
  rpcUrl: string;
  factoryId: string;
  factoryCodeHash: string;
  verifierId: string;
  verifierCodeHash: string;
  tokenId: string;
  tokenDecimals: number;
  vaultCodeHash: string;
  strategyCodeHash: string;
  transactionsEnabled: boolean;
}
export interface RegistryCampaign {
  id: string;
  name: string;
  creator_id: string;
  vault_id: string;
  strategy_id: string;
  beneficiary_id: string;
  token_id: string;
  metadata_hash: string;
  deposit_cap: string;
  status: "creating" | "registering" | "ready" | "failed";
  created_at: string;
  verification: null | {
    verifier_id: string;
    metadata_hash: string;
    evidence_hash: string;
    expires_at: string;
    issued_at: string;
    revoked: boolean;
  };
}
export interface RegistrySnapshot {
  height: number;
  blockHash: string;
  timestamp: string;
  cost: string;
  count: string;
  campaigns: RegistryCampaign[];
  policy: DaoPolicy;
}
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const slug = (v: string) => /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(v);
const u64 = (v: unknown) => {
  const result = raw(v);
  requireThat(BigInt(result) <= (1n << 64n) - 1n, "Integer exceeds u64");
  return result;
};
const encode = (v: unknown) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));

export function parseRegistry(value: unknown): RegistryDeployment {
  requireThat(
    value && typeof value === "object",
    "Invalid registry configuration",
  );
  const d = value as RegistryDeployment;
  requireThat(
    ["testnet", "mainnet", "sandbox"].includes(d.network),
    "Unsupported registry network",
  );
  const url = new URL(d.rpcUrl);
  requireThat(
    !url.username && !url.password && !url.search && !url.hash,
    "Registry RPC must not contain credentials",
  );
  requireThat(
    d.network === "sandbox"
      ? url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          !!d.chainId
      : url.protocol === "https:" && d.chainId === d.network,
    "Invalid registry network/RPC",
  );
  [d.factoryId, d.verifierId, d.tokenId].forEach(account);
  requireThat(
    new Set([d.factoryId, d.verifierId, d.tokenId]).size === 3,
    "Registry accounts must differ",
  );
  requireThat(
    [
      d.factoryCodeHash,
      d.verifierCodeHash,
      d.vaultCodeHash,
      d.strategyCodeHash,
    ].every(hash),
    "Registry code hashes required",
  );
  requireThat(
    Number.isInteger(d.tokenDecimals) &&
      d.tokenDecimals >= 0 &&
      d.tokenDecimals <= 24,
    "Invalid token precision",
  );
  requireThat(
    typeof d.transactionsEnabled === "boolean" &&
      (d.network === "testnet" || !d.transactionsEnabled),
    "Registry signing is only enabled for reviewed testnet deployments",
  );
  return d;
}
export function campaignVerified(
  c: RegistryCampaign,
  d: RegistryDeployment,
  timestamp: string,
) {
  const v = c.verification;
  return (
    c.status === "ready" &&
    !!v &&
    !v.revoked &&
    v.verifier_id === d.verifierId &&
    v.metadata_hash === c.metadata_hash &&
    BigInt(u64(v.expires_at)) > BigInt(u64(timestamp))
  );
}
function checkCampaign(c: RegistryCampaign, d: RegistryDeployment) {
  requireThat(
    slug(c.id) &&
      typeof c.name === "string" &&
      c.name.trim() &&
      new TextEncoder().encode(c.name).length <= 80,
    "Invalid campaign identity",
  );
  requireThat(
    c.vault_id === `v-${c.id}.${d.factoryId}` &&
      c.strategy_id === `s-${c.id}.${d.factoryId}` &&
      c.token_id === d.tokenId,
    "Campaign template binding changed",
  );
  [c.vault_id, c.strategy_id, c.creator_id, c.beneficiary_id].forEach(account);
  requireThat(
    hash(c.metadata_hash) && BigInt(raw(c.deposit_cap)) > 0n,
    "Invalid campaign metadata/cap",
  );
  requireThat(
    ["creating", "registering", "ready", "failed"].includes(c.status),
    "Invalid campaign status",
  );
  u64(c.created_at);
  if (c.verification) {
    requireThat(
      hash(c.verification.evidence_hash) &&
        hash(c.verification.metadata_hash) &&
        typeof c.verification.revoked === "boolean",
      "Invalid attestation",
    );
    account(c.verification.verifier_id);
    u64(c.verification.expires_at);
    u64(c.verification.issued_at);
  }
  return c;
}
export class CampaignRegistry {
  readonly deployment: RegistryDeployment;
  constructor(
    deployment: RegistryDeployment,
    private transport: typeof fetch = publicReadTransport,
  ) {
    this.deployment = parseRegistry(deployment);
  }
  async rpc<T>(method: string, params: object): Promise<T> {
    requireThat(
      ["status", "block", "query"].includes(method),
      "Registry is read only",
    );
    const response = await this.transport(this.deployment.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "yieldfund-registry",
        method,
        params,
      }),
      signal: AbortSignal.timeout(15000),
    });
    requireThat(response.ok, `Registry RPC unavailable (${response.status})`);
    const body = await response.json();
    requireThat(
      !body.error && "result" in body,
      "Registry RPC response failed",
    );
    return body.result;
  }
  async view<T>(
    id: string,
    method: string,
    args: object,
    block: string,
  ): Promise<T> {
    const result = await this.rpc<{ result: number[] }>("query", {
      request_type: "call_function",
      account_id: id,
      method_name: method,
      args_base64: encode(args),
      block_id: block,
    });
    return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
  }
  async snapshot(from = "0"): Promise<RegistrySnapshot> {
    u64(from);
    const d = this.deployment,
      status = await this.rpc<{
        chain_id: string;
        sync_info: { syncing: boolean };
      }>("status", {});
    requireThat(
      status.chain_id === d.chainId && !status.sync_info.syncing,
      "Wrong registry network or RPC is syncing",
    );
    const { header } = await this.rpc<{
      header: { hash: string; height: number; timestamp_nanosec: string };
    }>("block", { finality: "final" });
    const age =
      Date.now() - Number(BigInt(u64(header.timestamp_nanosec)) / 1_000_000n);
    requireThat(
      Number.isSafeInteger(header.height) && age >= -30000 && age < 120000,
      "Registry block is stale",
    );
    for (const [id, expected] of [
      [d.factoryId, d.factoryCodeHash],
      [d.verifierId, d.verifierCodeHash],
    ]) {
      const a = await this.rpc<{ code_hash: string }>("query", {
        request_type: "view_account",
        account_id: id,
        block_id: header.hash,
      });
      requireThat(
        base58HashHex(a.code_hash) === expected,
        `Registry code changed: ${id}`,
      );
    }
    const config = await this.view<Record<string, unknown>>(
      d.factoryId,
      "get_config",
      {},
      header.hash,
    );
    requireThat(
      config.verifier_id === d.verifierId &&
        config.token_id === d.tokenId &&
        config.token_decimals === d.tokenDecimals &&
        config.vault_code_hash === d.vaultCodeHash &&
        config.strategy_code_hash === d.strategyCodeHash &&
        config.strategy_mode === "funded_simulator",
      "Registry configuration changed",
    );
    const campaigns = await this.view<RegistryCampaign[]>(
      d.factoryId,
      "list_campaigns",
      { from_index: from, limit: 50 },
      header.hash,
    );
    requireThat(
      Array.isArray(campaigns) && campaigns.length <= 50,
      "Invalid campaign list",
    );
    const policy = await this.view<DaoPolicy>(
      d.verifierId,
      "get_policy",
      {},
      header.hash,
    );
    raw(policy.proposal_bond);
    requireThat(Array.isArray(policy.roles), "Invalid verifier policy");
    return {
      height: header.height,
      blockHash: header.hash,
      timestamp: header.timestamp_nanosec,
      cost: raw(config.creation_cost),
      count: u64(config.campaign_count),
      campaigns: campaigns.map((c) => checkCampaign(c, d)),
      policy,
    };
  }

  /** Build a runtime only from the reviewed token/DAO code and factory's pinned children. */
  async resolveCampaign(id: string, baseline: Deployment): Promise<Deployment> {
    const d = this.deployment;
    requireThat(
      d.network === baseline.network && d.tokenId === baseline.config.token_id,
      "Unsupported campaign network or token",
    );
    const s = await this.snapshot();
    const c = await this.view<RegistryCampaign | null>(
      d.factoryId,
      "get_campaign",
      { id },
      s.blockHash,
    );
    requireThat(c, "Campaign not found");
    checkCampaign(c, d);
    requireThat(c.status === "ready", "Campaign creation is not complete");
    const config = await this.view<VaultConfig>(
      c.vault_id,
      "get_config",
      {},
      s.blockHash,
    );
    requireThat(
      canonicalValue(config) ===
        canonicalValue({
          campaign_id: c.id,
          token_id: d.tokenId,
          token_decimals: d.tokenDecimals,
          beneficiary_id: c.beneficiary_id,
          guardian_id: c.creator_id,
          deposit_cap: c.deposit_cap,
          metadata_hash: c.metadata_hash,
          disclosure_version: "factory-v1",
          strategy_id: c.strategy_id,
        }),
      "Campaign vault binding changed",
    );
    const hashes = {
      [c.vault_id]: d.vaultCodeHash,
      [c.strategy_id]: d.strategyCodeHash,
      [d.tokenId]: baseline.codeHashes[d.tokenId],
      [c.beneficiary_id]: baseline.codeHashes[baseline.config.beneficiary_id],
    };
    for (const [accountId, expected] of Object.entries(hashes)) {
      const a = await this.rpc<{ code_hash: string }>("query", {
        request_type: "view_account",
        account_id: accountId,
        block_id: s.blockHash,
      });
      requireThat(
        base58HashHex(a.code_hash) === expected,
        `Unreviewed campaign code: ${accountId}`,
      );
    }
    for (const accountId of [c.vault_id, c.strategy_id]) {
      const keys = await this.rpc<{ keys: unknown[] }>("query", {
        request_type: "view_access_key_list",
        account_id: accountId,
        block_id: s.blockHash,
      });
      requireThat(
        Array.isArray(keys.keys) && keys.keys.length === 0,
        "Campaign child has access keys",
      );
    }
    const runtime = parseDeployment({
      ...baseline,
      displayName: c.name,
      vaultId: c.vault_id,
      rpcUrl: d.rpcUrl,
      config,
      codeHashes: hashes,
      daoPolicy: await this.view(
        c.beneficiary_id,
        "get_policy",
        {},
        s.blockHash,
      ),
      factoryInfo: await this.view(
        c.beneficiary_id,
        "get_factory_info",
        {},
        s.blockHash,
      ),
      transactionsEnabled: d.transactionsEnabled,
      authority:
        "Factory-created vault and simulator have no access keys. Creator controls bounded operations. Treasury authority is shown separately; test tokens only.",
    });
    requireThat(runtime.mode === "chain", "Invalid campaign runtime");
    return runtime;
  }
}
export interface NewCampaign {
  id: string;
  name: string;
  beneficiaryId: string;
  depositCap: string;
  metadataHash: string;
}
export function creationCall(
  d: RegistryDeployment,
  cost: string,
  input: NewCampaign,
): Call {
  parseRegistry(d);
  requireThat(slug(input.id), "Use a short lowercase campaign ID");
  account(`v-${input.id}.${d.factoryId}`);
  account(`s-${input.id}.${d.factoryId}`);
  const name = input.name.trim();
  requireThat(
    name && new TextEncoder().encode(name).length <= 80,
    "Name must be 1–80 bytes",
  );
  account(input.beneficiaryId);
  requireThat(
    ![
      d.factoryId,
      d.tokenId,
      `v-${input.id}.${d.factoryId}`,
      `s-${input.id}.${d.factoryId}`,
    ].includes(input.beneficiaryId),
    "Invalid treasury account",
  );
  requireThat(
    hash(input.metadataHash) &&
      BigInt(raw(input.depositCap)) > 0n &&
      BigInt(raw(cost)) > 0n,
    "Invalid metadata, cap or cost",
  );
  return {
    receiverId: d.factoryId,
    methodName: "create_campaign",
    gas: "300000000000000",
    deposit: cost,
    args: {
      id: input.id,
      name,
      beneficiary_id: input.beneficiaryId,
      metadata_hash: input.metadataHash,
      deposit_cap: input.depositCap,
    },
  };
}
export async function campaignMetadata(
  input: Omit<NewCampaign, "metadataHash">,
  tokenId: string,
) {
  const content = canonical({
    id: input.id,
    name: input.name.trim(),
    beneficiary_id: input.beneficiaryId,
    deposit_cap: raw(input.depositCap),
    token_id: account(tokenId),
    disclosure_version: "factory-v1",
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return {
    content,
    hash: Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
export function verificationProposal(
  d: RegistryDeployment,
  policy: DaoPolicy,
  actor: string,
  campaign: RegistryCampaign,
  action:
    | { kind: "verify"; evidenceHash: string; expiresAt: string }
    | { kind: "revoke" },
  now: string,
): Call {
  checkCampaign(campaign, d);
  account(actor);
  requireThat(
    policy.roles.some(
      (r) =>
        (r.kind === "Everyone" ||
          (typeof r.kind === "object" &&
            "Group" in r.kind &&
            r.kind.Group.includes(actor))) &&
        r.permissions.some((p) =>
          ["*:*", "call:*", "*:AddProposal", "call:AddProposal"].includes(p),
        ),
    ),
    "Verification proposal permission required",
  );
  requireThat(campaign.status === "ready", "Campaign is not ready");
  if (action.kind === "verify")
    requireThat(
      hash(action.evidenceHash) &&
        BigInt(u64(action.expiresAt)) > BigInt(u64(now)),
      "Invalid evidence or expiry",
    );
  const args =
    action.kind === "verify"
      ? {
          id: campaign.id,
          metadata_hash: campaign.metadata_hash,
          evidence_hash: action.evidenceHash,
          expires_at: action.expiresAt,
        }
      : { id: campaign.id };
  return {
    receiverId: d.verifierId,
    methodName: "add_proposal",
    gas: "100000000000000",
    deposit: raw(policy.proposal_bond),
    args: {
      proposal: {
        description: `${action.kind === "verify" ? "Verify" : "Revoke verification for"} campaign ${campaign.id}`,
        kind: {
          FunctionCall: {
            receiver_id: d.factoryId,
            actions: [
              {
                method_name:
                  action.kind === "verify"
                    ? "verify_campaign"
                    : "revoke_verification",
                args: encode(args),
                deposit: "1",
                gas: "30000000000000",
              },
            ],
          },
        },
      },
    },
  };
}

export interface VerificationProposal {
  id: number;
  status: string;
  description: string;
  votes: Record<string, string>;
  kind: {
    FunctionCall: {
      receiver_id: string;
      actions: Array<{
        method_name: string;
        args: string;
        deposit: string;
        gas: string;
      }>;
    };
  };
}
export function verificationAction(
  d: RegistryDeployment,
  policy: DaoPolicy,
  actor: string,
  campaign: RegistryCampaign,
  proposal: VerificationProposal,
  action: "VoteApprove" | "VoteReject" | "Finalize",
  now: string,
): Call {
  parseRegistry(d);
  checkCampaign(campaign, d);
  account(actor);
  requireThat(
    Number.isSafeInteger(proposal.id) && proposal.id >= 0,
    "Invalid proposal ID",
  );
  requireThat(
    action === "Finalize"
      ? proposal.status === "Failed"
      : proposal.status === "InProgress",
    "Proposal is not actionable",
  );
  requireThat(
    policy.roles.some(
      (r) =>
        (r.kind === "Everyone" ||
          (typeof r.kind === "object" &&
            "Group" in r.kind &&
            r.kind.Group.includes(actor))) &&
        r.permissions.some((p) =>
          ["*:*", "call:*", `*:${action}`, `call:${action}`].includes(p),
        ),
    ),
    "Verification vote permission required",
  );
  const call = proposal.kind?.FunctionCall;
  requireThat(
    call?.receiver_id === d.factoryId && call.actions.length === 1,
    "Unexpected verification target",
  );
  const a = call.actions[0],
    args = decode(a.args) as Record<string, unknown>;
  requireThat(
    a.deposit === "1" && a.gas === "30000000000000" && args.id === campaign.id,
    "Verification parameters changed",
  );
  if (a.method_name === "verify_campaign") {
    requireThat(
      canonical(Object.keys(args).sort()) ===
        canonical(["evidence_hash", "expires_at", "id", "metadata_hash"]),
      "Unexpected verification fields",
    );
    requireThat(
      args.metadata_hash === campaign.metadata_hash &&
        hash(args.evidence_hash) &&
        BigInt(u64(args.expires_at)) > BigInt(u64(now)),
      "Verification metadata changed or expired",
    );
  } else
    requireThat(
      a.method_name === "revoke_verification" &&
        canonical(args) === canonical({ id: campaign.id }),
      "Unsupported verification action",
    );
  return {
    receiverId: d.verifierId,
    methodName: "act_proposal",
    args: { id: proposal.id, action, proposal: structuredClone(proposal.kind) },
    deposit: "0",
    gas: "250000000000000",
  };
}

import { describe, it, expect, vi } from "vitest";
import {
  CampaignRegistry,
  campaignMetadata,
  campaignVerified,
  creationCall,
  parseRegistry,
  verificationProposal,
  type RegistryDeployment,
  type RegistryCampaign,
} from "./campaigns";
import type { DaoPolicy } from "./index";
import { decode } from "./chain";
const d: RegistryDeployment = {
  network: "testnet",
  chainId: "testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  factoryId: "factory.testnet",
  factoryCodeHash: "0".repeat(64),
  verifierId: "verification.testnet",
  verifierCodeHash: "0".repeat(64),
  tokenId: "token.testnet",
  tokenDecimals: 6,
  vaultCodeHash: "a".repeat(64),
  strategyCodeHash: "b".repeat(64),
  transactionsEnabled: false,
};
const campaign: RegistryCampaign = {
  id: "alpha",
  name: "Alpha",
  creator_id: "alice.testnet",
  vault_id: "v-alpha.factory.testnet",
  strategy_id: "s-alpha.factory.testnet",
  beneficiary_id: "dao.testnet",
  token_id: d.tokenId,
  metadata_hash: "a".repeat(64),
  deposit_cap: "1000000000",
  status: "ready",
  created_at: "1",
  verification: null,
};
const policy: DaoPolicy = {
  roles: [
    {
      name: "council",
      kind: { Group: ["one.testnet", "two.testnet", "three.testnet"] },
      permissions: ["call:AddProposal", "call:VoteApprove"],
      vote_policy: {},
    },
  ],
  proposal_bond: "100000000000000000000000",
  proposal_period: "10",
  default_vote_policy: {
    weight_kind: "RoleWeight",
    quorum: "2",
    threshold: "2",
  },
};
const input = {
  id: "alpha",
  name: "Alpha",
  beneficiaryId: "dao.testnet",
  depositCap: "1000000000",
  metadataHash: "a".repeat(64),
};
describe("campaign registry preparation", () => {
  it("binds exact creation funding, immutable destinations and template accounts", () => {
    const call = creationCall(d, "7235220000000000000000000", input);
    expect(call.receiverId).toBe(d.factoryId);
    expect(call.deposit).toBe("7235220000000000000000000");
    expect(call.args).toEqual({
      id: "alpha",
      name: "Alpha",
      beneficiary_id: "dao.testnet",
      deposit_cap: "1000000000",
      metadata_hash: "a".repeat(64),
    });
  });
  it.each(["../x", "a.b", "A", "-a", "a-", "a".repeat(25)])(
    "rejects invalid campaign ID %s",
    (id) => expect(() => creationCall(d, "1", { ...input, id })).toThrow(),
  );
  it("rejects account overflow, self-beneficiary, overflow amounts and UTF-8 name overflow", () => {
    expect(() =>
      creationCall({ ...d, factoryId: "a".repeat(60) + ".xx" }, "1", input),
    ).toThrow();
    expect(() =>
      creationCall(d, "1", { ...input, beneficiaryId: d.tokenId }),
    ).toThrow();
    expect(() =>
      creationCall(d, "1", { ...input, depositCap: (1n << 128n).toString() }),
    ).toThrow();
    expect(() =>
      creationCall(d, "1", { ...input, name: "🌱".repeat(21) }),
    ).toThrow();
  });
  it("hashes canonical metadata and binds a changed beneficiary", async () => {
    const a = await campaignMetadata(input, d.tokenId),
      b = await campaignMetadata(
        { ...input, beneficiaryId: "different.testnet" },
        d.tokenId,
      );
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toBe(b.hash);
    expect(
      (await campaignMetadata({ ...input, name: " Alpha " }, d.tokenId)).hash,
    ).toBe(a.hash);
  });
  it("builds an exact DAO function-call proposal; creator and transfer-only roles are denied", () => {
    const action = {
      kind: "verify" as const,
      evidenceHash: "c".repeat(64),
      expiresAt: "20",
    };
    expect(() =>
      verificationProposal(d, policy, "alice.testnet", campaign, action, "10"),
    ).toThrow("permission");
    const transferPolicy = structuredClone(policy);
    transferPolicy.roles[0].permissions = ["transfer:AddProposal"];
    expect(() =>
      verificationProposal(
        d,
        transferPolicy,
        "one.testnet",
        campaign,
        action,
        "10",
      ),
    ).toThrow("permission");
    const call = verificationProposal(
      d,
      policy,
      "one.testnet",
      campaign,
      action,
      "10",
    );
    expect(call.receiverId).toBe(d.verifierId);
    expect(call.deposit).toBe(policy.proposal_bond);
    const proposal = call.args.proposal as {
      kind: {
        FunctionCall: {
          receiver_id: string;
          actions: Array<{
            args: string;
            deposit: string;
            method_name: string;
          }>;
        };
      };
    };
    expect(proposal.kind.FunctionCall.receiver_id).toBe(d.factoryId);
    expect(proposal.kind.FunctionCall.actions[0].deposit).toBe("1");
    expect(decode(proposal.kind.FunctionCall.actions[0].args)).toEqual({
      id: campaign.id,
      metadata_hash: campaign.metadata_hash,
      evidence_hash: action.evidenceHash,
      expires_at: "20",
    });
  });
  it("never derives verification from creator identity or expired/revoked/foreign attestations", () => {
    expect(campaignVerified(campaign, d, "10")).toBe(false);
    const verified = {
      ...campaign,
      verification: {
        verifier_id: d.verifierId,
        metadata_hash: campaign.metadata_hash,
        evidence_hash: "b".repeat(64),
        issued_at: "1",
        expires_at: "20",
        revoked: false,
      },
    };
    expect(campaignVerified(verified, d, "10")).toBe(true);
    expect(campaignVerified(verified, d, "20")).toBe(false);
    for (const patch of [
      { revoked: true },
      { verifier_id: "alice.testnet" },
      { metadata_hash: "c".repeat(64) },
    ])
      expect(
        campaignVerified(
          { ...verified, verification: { ...verified.verification, ...patch } },
          d,
          "10",
        ),
      ).toBe(false);
  });
  it("permits mainnet reads but refuses unreviewed mainnet signing and credential URLs", () => {
    expect(
      parseRegistry({ ...d, network: "mainnet", chainId: "mainnet" }).network,
    ).toBe("mainnet");
    expect(() =>
      parseRegistry({
        ...d,
        network: "mainnet",
        chainId: "mainnet",
        transactionsEnabled: true,
      }),
    ).toThrow("signing");
    expect(() =>
      parseRegistry({ ...d, rpcUrl: "https://rpc.example?api_key=secret" }),
    ).toThrow("credentials");
  });
});
function transport(mode = "ok") {
  return vi.fn(async (_url, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    if (method === "status")
      result = {
        chain_id: mode === "wrong-chain" ? "mainnet" : "testnet",
        sync_info: { syncing: false },
      };
    else if (method === "block")
      result = {
        header: {
          hash: "final",
          height: 10,
          timestamp_nanosec: String(
            BigInt(Date.now() - (mode === "stale" ? 180000 : 0)) * 1_000_000n,
          ),
        },
      };
    else {
      expect(params.block_id).toBe("final");
      if (params.request_type === "view_account")
        result = { code_hash: mode === "changed-code" ? "2" : "1".repeat(32) };
      else {
        let value: unknown;
        if (params.method_name === "get_config")
          value = {
            verifier_id: d.verifierId,
            token_id: mode === "changed-token" ? "other.testnet" : d.tokenId,
            token_decimals: 6,
            vault_code_hash: d.vaultCodeHash,
            strategy_code_hash: d.strategyCodeHash,
            strategy_mode: "funded_simulator",
            creation_cost: "1",
            campaign_count: "1",
          };
        else if (params.method_name === "get_policy") value = policy;
        else
          value = [
            mode === "foreign-child"
              ? { ...campaign, vault_id: "attacker.testnet" }
              : campaign,
          ];
        result = {
          result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
        };
      }
    }
    return Response.json({ result });
  });
}
describe("registry chain reads", () => {
  it("pins all reads to one finalized block and verifies both code hashes/configuration", async () => {
    const snapshot = await new CampaignRegistry(d, transport()).snapshot();
    expect(snapshot.campaigns[0].id).toBe("alpha");
    expect(snapshot.blockHash).toBe("final");
    expect(snapshot.policy).toEqual(policy);
  });
  it.each([
    "wrong-chain",
    "stale",
    "changed-code",
    "changed-token",
    "foreign-child",
  ])("rejects %s evidence", async (mode) => {
    await expect(
      new CampaignRegistry(d, transport(mode)).snapshot(),
    ).rejects.toThrow();
  });
  it("cannot broadcast", async () => {
    const tx = transport();
    await expect(
      new CampaignRegistry(d, tx).rpc("send_tx", {}),
    ).rejects.toThrow("read only");
    expect(tx).not.toHaveBeenCalled();
  });
});

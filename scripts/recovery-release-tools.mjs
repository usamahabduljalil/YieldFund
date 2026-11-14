// Shared read-only checks for the exact approved v2 release.
import { readFile, writeFile, access } from "node:fs/promises";
import {
  canonical,
  base58HashHex,
  normalizedPolicy,
} from "../packages/near-client/src/chain.ts";
import { releaseDigest } from "./public-release.mjs";
export const REVIEW =
  "6d55bbccf4108a7bc6c8ac362c965ac4409b7695f4f122b07803d0aaed75bec5";
export const json = async (p) => JSON.parse(await readFile(p, "utf8"));
export const assert = (v, message) => {
  if (!v) throw Error(message);
};
export const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};
export const save = (p, value) =>
  writeFile(p, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
export const plan = await json("deployments/recovery-release.review.json");
assert(releaseDigest(plan) === REVIEW, "Reviewed plan changed");
export const out = "docs/evidence/milestone-16-public-receipts";
let lastReadAt = 0;
export async function rpc(method, params, url = plan.rpcUrl) {
  const readOnly = !method.startsWith("broadcast_");
  const attempts = readOnly ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (readOnly) {
      const pause = Math.max(0, lastReadAt + 400 - Date.now());
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
      lastReadAt = Date.now();
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "v2-release",
        method,
        params,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (
      readOnly &&
      [408, 429, 502, 503, 504].includes(r.status) &&
      attempt + 1 < attempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
      continue;
    }
    assert(r.ok, `RPC HTTP ${r.status}`);
    const result = await r.json();
    if (result.error) throw Error(JSON.stringify(result.error));
    return result.result;
  }
}
export async function freshBlock() {
  assert((await rpc("status", {})).chain_id === "testnet", "Wrong network");
  const block = await rpc("block", { finality: "final" });
  assert(
    Date.now() - Number(BigInt(block.header.timestamp_nanosec) / 1000000n) <
      120000,
    "Stale block",
  );
  return block.header;
}
export const query = (type, id, block) =>
  rpc("query", { request_type: type, account_id: id, block_id: block.hash });
export async function view(id, method, args, block) {
  const r = await rpc("query", {
    request_type: "call_function",
    account_id: id,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    block_id: block.hash,
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
export async function audit(index, block) {
  block ??= await freshBlock();
  const base = await json("deployments/testnet.json"),
    dao = base.config.beneficiary_id;
  const evidence = {
    reviewSha256: REVIEW,
    index,
    block,
    accounts: {},
    campaigns: [],
  };
  const accounts = (await json("docs/evidence/milestone-16-accounts.json"))
    .accounts;
  for (const id of Object.keys(plan.accounts)) {
    const keys = await query("view_access_key_list", id, block);
    assert(
      canonical(
        keys.keys.map((k) => ({
          public_key: k.public_key,
          permission: k.access_key.permission,
        })),
      ) ===
        canonical(
          accounts[id].keys.keys.map((k) => ({
            public_key: k.public_key,
            permission: k.access_key.permission,
          })),
        ),
      `Authority changed: ${id}`,
    );
    evidence.accounts[id] = {
      account: await query("view_account", id, block),
      keys,
    };
  }
  for (const id of [dao, plan.verifierId]) {
    const policy = await view(id, "get_policy", {}, block),
      code = await query("view_account", id, block);
    const expected = structuredClone(base.daoPolicy);
    if (id === plan.verifierId)
      expected.roles[0].permissions = [
        "call:AddProposal",
        "call:Finalize",
        "call:VoteApprove",
        "call:VoteReject",
      ];
    assert(
      normalizedPolicy(policy) === normalizedPolicy(expected),
      "DAO policy changed",
    );
    assert(
      base58HashHex(code.code_hash) === base.codeHashes[dao],
      "DAO code changed",
    );
    evidence.accounts[id] = { account: code, policy };
  }
  if (index >= 0) {
    assert(
      base58HashHex(evidence.accounts[plan.tokenId].account.code_hash) ===
        plan.artifacts["yieldfund_test_token.wasm"].sha256,
      "Token code mismatch",
    );
    evidence.supply = await view(plan.tokenId, "ft_total_supply", {}, block);
    evidence.storage = await view(
      plan.tokenId,
      "storage_balance_bounds",
      {},
      block,
    );
    assert(
      evidence.supply === "1000000000000" &&
        evidence.storage.min === plan.tokenStorage,
      "Token supply/storage mismatch",
    );
  }
  if (index >= 2) {
    assert(
      base58HashHex(evidence.accounts[plan.factoryId].account.code_hash) ===
        plan.artifacts["yieldfund_campaign_factory.wasm"].sha256,
      "Factory code mismatch",
    );
    const c = (evidence.factoryConfig = await view(
      plan.factoryId,
      "get_config",
      {},
      block,
    ));
    assert(
      c.recovery_version === 2 &&
        c.verifier_id === plan.verifierId &&
        c.token_id === plan.tokenId &&
        c.creation_cost === plan.creationCost &&
        c.vault_code_hash === plan.artifacts["yieldfund_vault.wasm"].sha256 &&
        c.strategy_code_hash ===
          plan.artifacts["yieldfund_strategy_simulator.wasm"].sha256,
      "Factory configuration mismatch",
    );
  }
  for (const [creationIndex, name] of [
    [3, "commons"],
    [4, "builders"],
  ]) {
    if (index < creationIndex) continue;
    const creation = plan.steps[creationIndex],
      args = creation.actions[0].args;
    const campaign = await view(
      plan.factoryId,
      "get_campaign",
      { id: name },
      block,
    );
    assert(
      campaign?.status === "ready" &&
        campaign.creator_id === creation.signerId &&
        campaign.metadata_hash === args.metadata_hash &&
        campaign.deposit_cap === args.deposit_cap &&
        campaign.beneficiary_id === args.beneficiary_id,
      "Campaign mismatch/not ready",
    );
    for (const [id, artifact] of [
      [campaign.vault_id, "yieldfund_vault.wasm"],
      [campaign.strategy_id, "yieldfund_strategy_simulator.wasm"],
    ]) {
      assert(
        (await query("view_access_key_list", id, block)).keys.length === 0,
        "Child has keys",
      );
      assert(
        base58HashHex((await query("view_account", id, block)).code_hash) ===
          plan.artifacts[artifact].sha256,
        "Child code mismatch",
      );
      assert(
        await view(
          plan.tokenId,
          "storage_balance_of",
          { account_id: id },
          block,
        ),
        "Child not registered",
      );
    }
    const config = await view(campaign.vault_id, "get_config", {}, block),
      strategy = await view(campaign.strategy_id, "get_position", {}, block);
    assert(
      config.campaign_id === name &&
        config.token_id === plan.tokenId &&
        config.guardian_id === creation.signerId &&
        config.strategy_id === campaign.strategy_id &&
        config.beneficiary_id === args.beneficiary_id &&
        config.metadata_hash === args.metadata_hash &&
        config.disclosure_version === "factory-v2",
      "Vault bindings mismatch",
    );
    assert(
      strategy.token_id === plan.tokenId &&
        strategy.vault_id === campaign.vault_id &&
        strategy.controller_id === creation.signerId,
      "Simulator bindings mismatch",
    );
    if (name === "commons" && index === 19) {
      const wanted = JSON.parse(
        Buffer.from(
          plan.steps[17].actions[0].args.proposal.kind.FunctionCall.actions[0]
            .args,
          "base64",
        ).toString(),
      );
      assert(
        campaign.verification &&
          !campaign.verification.revoked &&
          campaign.verification.metadata_hash === wanted.metadata_hash &&
          campaign.verification.evidence_hash === wanted.evidence_hash &&
          campaign.verification.expires_at === wanted.expires_at,
        "Verification mismatch",
      );
    } else assert(!campaign.verification, "Unexpected verification");
    const accounting = await view(
      campaign.vault_id,
      "get_accounting",
      {},
      block,
    );
    const cash =
      name === "builders" || index < 6
        ? "0"
        : index < 7
          ? "100000000"
          : index < 9
            ? "0"
            : index < 10
              ? "103000000"
              : index < 12
                ? "100000000"
                : "80000000";
    const nominal =
      name === "builders" || index < 6
        ? "0"
        : index < 12
          ? "100000000"
          : "80000000";
    assert(
      accounting.cash === cash && accounting.nominal === nominal,
      "Vault cash/units mismatch",
    );
    assert(
      accounting.strategy_book ===
        (name === "commons" && index >= 7 && index < 9 ? "100000000" : "0"),
      "Strategy book mismatch",
    );
    assert(
      accounting.donated ===
        (name === "commons" && index >= 10 ? "3000000" : "0"),
      "Donation mismatch",
    );
    if (index >= 12 && name === "commons") {
      const position = await view(
        campaign.vault_id,
        "get_position",
        { account_id: creation.signerId },
        block,
      );
      assert(
        position.withdrawn === "20000000" &&
          position.reserved === "0" &&
          accounting.active_operation === null &&
          accounting.reserved_outbound === "0",
        "Withdrawal not settled",
      );
      evidence.position = position;
    }
    evidence.campaigns.push({ campaign, config, strategy, accounting });
  }
  if (index >= 3) {
    const balance = (id) =>
      view(plan.tokenId, "ft_balance_of", { account_id: id }, block);
    const demo = plan.steps[3].signerId,
      vault = `v-commons.${plan.factoryId}`,
      strategy = `s-commons.${plan.factoryId}`;
    const recipient = plan.steps[13].actions[0].args.account_id;
    evidence.tokenBalances = {};
    const expected = {
      [demo]:
        index < 6
          ? "1000000000000"
          : index < 8
            ? "999900000000"
            : index < 12
              ? "999897000000"
              : "999917000000",
      [vault]:
        index < 6
          ? "0"
          : index < 7
            ? "100000000"
            : index < 9
              ? "0"
              : index < 10
                ? "103000000"
                : index < 12
                  ? "100000000"
                  : "80000000",
      [strategy]:
        index < 7 || index >= 9 ? "0" : index < 8 ? "100000000" : "103000000",
      [dao]: index < 10 ? "0" : index < 16 ? "3000000" : "1000000",
      [recipient]: index < 16 ? "0" : "2000000",
    };
    for (const [id, amount] of Object.entries(expected)) {
      evidence.tokenBalances[id] = await balance(id);
      assert(
        evidence.tokenBalances[id] === amount,
        `Token balance mismatch: ${id}`,
      );
    }
  }
  for (const [proposalIndex, target, secondVote] of [
    [14, dao, 16],
    [17, plan.verifierId, 19],
  ]) {
    if (index < proposalIndex) continue;
    const proposalId = plan.steps[proposalIndex + 1].actions[0].args.id;
    const p = await view(target, "get_proposal", { id: proposalId }, block);
    assert(
      canonical(p.kind) ===
        canonical(plan.steps[proposalIndex].actions[0].args.proposal.kind),
      "Proposal kind mismatch",
    );
    assert(
      p.status === (index >= secondVote ? "Approved" : "InProgress") &&
        Object.keys(p.votes).length === Math.min(index - proposalIndex, 2),
      "Proposal votes/status mismatch",
    );
    evidence[target] = p;
  }
  return evidence;
}

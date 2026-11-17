// Read-only: checks the actual DAO bindings, then emits manifests for Trezu import.
// Input JSON: {rpcUrl, network:"mainnet", daoId, factoryId?, vaultId?}
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { account } from "../packages/near-client/src/chain.ts";
import {
  trezuLinks,
  verificationTemplates,
  yieldSettlementTemplate,
  rheaOperationTemplates,
} from "../packages/near-client/src/trezu.ts";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: node --experimental-strip-types scripts/export-trezu-templates.mjs public-config.json output-directory",
  );
const config = JSON.parse(await readFile(input, "utf8"));
const links = trezuLinks(config.network, config.daoId);
const rpcUrl = new URL(config.rpcUrl);
if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password)
  throw new Error("Use a public HTTPS RPC URL");
async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trezu-export",
      method,
      params,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const status = await rpc("status", {});
if (status.chain_id !== "mainnet" || status.sync_info.syncing)
  throw new Error("Expected synchronized mainnet RPC");
const block = await rpc("block", { finality: "final" });
async function view(id, method) {
  const result = await rpc("query", {
    request_type: "call_function",
    block_id: block.header.hash,
    account_id: account(id),
    method_name: method,
    args_base64: "e30=",
  });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}
const policy = await view(config.daoId, "get_policy");
if (!Array.isArray(policy.roles)) throw new Error("DAO policy unavailable");
for (const permission of ["AddProposal", "VoteApprove"]) {
  if (
    !policy.roles.some((role) =>
      role.permissions?.some((p) =>
        ["*:*", "call:*", `call:${permission}`, `*:${permission}`].includes(p),
      ),
    )
  ) {
    throw new Error(
      `DAO policy does not authorize function-call ${permission}`,
    );
  }
}
const manifests = [];
if (config.factoryId) {
  const factory = await view(config.factoryId, "get_config");
  if (factory.verifier_id !== config.daoId)
    throw new Error("DAO is not this factory's on-chain verifier");
  manifests.push(...verificationTemplates(config.factoryId));
}
if (config.vaultId) {
  const vault = await view(config.vaultId, "get_config");
  if (
    vault.guardian_id !== config.daoId ||
    vault.beneficiary_id !== config.daoId
  )
    throw new Error(
      "DAO must be both guardian and beneficiary for settlement template",
    );
  const costs = await view(config.vaultId, "storage_costs");
  manifests.push(
    ...(typeof vault.rhea_extra_decimals === "number"
      ? rheaOperationTemplates(config.vaultId, costs.operation)
      : [yieldSettlementTemplate(config.vaultId, costs.operation)]),
  );
}
if (!manifests.length) throw new Error("Specify factoryId or vaultId");
await mkdir(output, { recursive: true });
for (const manifest of manifests)
  await writeFile(
    resolve(output, `${manifest.id}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
await writeFile(
  resolve(output, "review.json"),
  JSON.stringify(
    {
      network: "mainnet",
      daoId: config.daoId,
      checkedAt: new Date().toISOString(),
      block: { height: block.header.height, hash: block.header.hash },
      links,
      policy,
      templates: manifests.map((m) => m.id),
      installed: false,
      signatures: 0,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  `Wrote ${manifests.length} templates. Import through ${links.createTemplate}; DAO membership and ChangePolicy permission are required by Trezu.`,
);

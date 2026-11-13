// Public data only. This tool never loads keys, signs, broadcasts, or enables signing.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  account,
  canonical,
  ChainClient,
  parseDeployment,
  raw,
  requireThat,
} from "../packages/near-client/src/chain.ts";

export const artifacts = {
  vault: [
    "yieldfund_vault.wasm",
    "250fd465d930ac23081e3e04929d59b036e82a30f11fed7e1dd799efc77d00ad",
  ],
  token: [
    "yieldfund_test_token.wasm",
    "1e22e0afefecbcef57415c96bdbeefe440f675aaabada45255ac51f9587af9ad",
  ],
  strategy: [
    "yieldfund_strategy_simulator.wasm",
    "2900d891851a0fd844bed39fda877bb983ece54d2f99f1fb2a3c0c79c009004b",
  ],
  dao: [
    "sputnikdao2.wasm",
    "2ed1d58bb2837f29b7629f833fea16bf661b4bea31fd4cceede4dc1f723d6cea",
  ],
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const roles = Object.keys(artifacts);
const near = 10n ** 24n;
// Replace a retired RPC transport without rewriting the reviewed plan/hash.
// Network, freshness, contracts and authority are still checked by the caller.
export function readOnlyRpcOverride(
  url,
  transport = (...args) => fetch(...args),
) {
  const target = new URL(url);
  requireThat(
    target.protocol === "https:" &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash,
    "RPC override must be a public HTTPS URL without credentials, query or fragment",
  );
  return (_original, options) => {
    const request = JSON.parse(options.body);
    requireThat(
      [
        "status",
        "block",
        "query",
        "gas_price",
        "EXPERIMENTAL_protocol_config",
      ].includes(request.method),
      "RPC override only permits deployment read methods",
    );
    return transport(target.href, options);
  };
}
// Per-contract balances cover reviewed Wasm, 64 KiB initial-state headroom,
// initialization gas and at least 1 NEAR operating reserve at the checked price.
export const contractFunding = { vault: 6n, token: 5n, strategy: 4n, dao: 7n };
function publicKey(key) {
  requireThat(
    typeof key === "string" &&
      /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key),
    "Expected an ed25519 public key, never a secret key",
  );
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const encoded = key.slice(8);
  let n = 0n;
  for (const char of encoded) n = n * 58n + BigInt(alphabet.indexOf(char));
  const size =
    (n === 0n ? 0 : Math.ceil(n.toString(16).length / 2)) +
    encoded.match(/^1*/)[0].length;
  requireThat(size === 32, "Public key must decode to 32 bytes");
  return key;
}
function testnetId(id) {
  account(id);
  requireThat(
    id.endsWith(".testnet") || /^[0-9a-f]{64}$/.test(id),
    "Use a named .testnet or 64-character implicit account",
  );
  return id;
}
export async function verifyArtifacts(directory) {
  const result = {};
  for (const [role, [file, hash]] of Object.entries(artifacts)) {
    const bytes = await readFile(resolve(directory, file));
    requireThat(sha256(bytes) === hash, `Unreviewed artifact: ${file}`);
    result[role] = { file, sha256: hash, bytes: bytes.length };
  }
  return result;
}
export async function inspectAccounts(
  input,
  transport = (...args) => fetch(...args),
) {
  requireThat(input.schemaVersion === 1, "Unsupported account input");
  const ids = [input.operatorId, ...input.council].map(testnetId);
  requireThat(
    ids.length === 4 && new Set(input.council).size === 3,
    "Operator and three distinct council accounts required",
  );
  const url = new URL(input.rpcUrl);
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "Use a public HTTPS RPC URL",
  );
  async function rpc(method, params) {
    const response = await transport(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "yieldfund-read-only",
        method,
        params,
      }),
      signal: AbortSignal.timeout(15000),
    });
    requireThat(response.ok, `RPC unavailable (${response.status})`);
    return response.json();
  }
  const status = await rpc("status", {});
  requireThat(
    status.result?.chain_id === "testnet" &&
      status.result.sync_info?.syncing === false,
    "Wrong network or syncing",
  );
  const block = await rpc("block", { finality: "final" });
  const header = block.result?.header;
  requireThat(
    header?.hash && Number.isSafeInteger(header.height),
    "Missing finalized block",
  );
  const timestamp = Number(BigInt(header.timestamp_nanosec) / 1000000n);
  requireThat(
    Date.now() - timestamp < 120000 && timestamp - Date.now() < 30000,
    "Finalized network data is stale",
  );
  const observations = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const response = await rpc("query", {
        request_type: "view_account",
        account_id: id,
        block_id: header.hash,
      });
      if (response.error) {
        const cause = response.error.cause;
        requireThat(
          cause?.name === "UNKNOWN_ACCOUNT" &&
            cause.info?.block_hash === header.hash &&
            cause.info.requested_account_id === id,
          "Account query failed without conclusive absence evidence",
        );
        return { accountId: id, status: "not_created", error: response.error };
      }
      requireThat(
        response.result?.block_hash === header.hash,
        "Account observation is from another block",
      );
      raw(response.result.amount);
      return { accountId: id, status: "exists", account: response.result };
    }),
  );
  return {
    schemaVersion: 1,
    network: "testnet",
    rpcUrl: url.href,
    checkedAt: new Date().toISOString(),
    blockHash: header.hash,
    blockHeight: header.height,
    blockTimestampNs: header.timestamp_nanosec,
    allExist: observations.every((a) => a.status === "exists"),
    observations,
    limitation:
      "Existence does not prove control, sufficient spendable balance, or independent council custody.",
  };
}
export function makePlan(input) {
  requireThat(input.schemaVersion === 1, "Unsupported setup schema");
  const operator = testnetId(input.operatorId);
  const deployer = testnetId(input.deployerId);
  requireThat(
    deployer.endsWith(".testnet"),
    "A named testnet deployer is required for child contract accounts",
  );
  const ids = roles.map((role) => testnetId(input.contracts[role].accountId));
  requireThat(
    new Set(ids).size === 4,
    "Four distinct contract accounts required",
  );
  for (const role of roles) {
    const c = input.contracts[role];
    requireThat(
      c.accountId.endsWith(`.${deployer}`) &&
        c.accountId.slice(0, -deployer.length - 1).indexOf(".") === -1,
      "Contracts must be direct children of the deployer",
    );
    publicKey(c.publicKey);
  }
  const council = input.council.map(testnetId);
  requireThat(
    council.length === 3 && new Set(council).size === 3,
    "Three distinct council accounts required",
  );
  [
    input.guardianId,
    input.controllerId,
    input.lossSinkId,
    input.recipientId,
  ].forEach(testnetId);
  requireThat(
    ![
      operator,
      deployer,
      ...council,
      input.guardianId,
      input.controllerId,
      input.lossSinkId,
      input.recipientId,
    ].some((id) => ids.includes(id)),
    "Actor and contract accounts must be separate",
  );
  requireThat(
    typeof input.authority === "string" && input.authority.trim().length >= 20,
    "Document key custody and retained upgrade authority",
  );
  const cap = raw(input.depositCap),
    supply = raw(input.totalSupply);
  requireThat(
    BigInt(cap) >= 1000_000000n && BigInt(supply) >= BigInt(cap) + 30_000000n,
    "Supply must cover the cap plus the 30-token funded-profit rehearsal",
  );
  requireThat(
    input.metadata &&
      typeof input.metadata === "object" &&
      !Array.isArray(input.metadata),
    "Campaign metadata required",
  );
  const metadata = canonical(input.metadata);
  const [vaultId, tokenId, strategyId, daoId] = ids;
  const config = {
    campaign_id: "commons",
    token_id: tokenId,
    token_decimals: 6,
    beneficiary_id: daoId,
    guardian_id: input.guardianId,
    deposit_cap: cap,
    metadata_hash: sha256(metadata),
    disclosure_version: "1.0",
    strategy_id: strategyId,
  };
  const daoPolicy = {
    roles: [
      {
        name: "council",
        kind: { Group: council },
        permissions: [
          "transfer:AddProposal",
          "transfer:Finalize",
          "transfer:VoteApprove",
          "transfer:VoteReject",
        ],
        vote_policy: {},
      },
    ],
    default_vote_policy: {
      weight_kind: "RoleWeight",
      quorum: "2",
      threshold: "2",
    },
    proposal_bond: (near / 10n).toString(),
    proposal_period: "604800000000000",
    bounty_bond: "0",
    bounty_forgiveness_period: "86400000000000",
  };
  const manifest = parseDeployment({
    mode: "chain",
    network: "testnet",
    chainId: "testnet",
    rpcUrl: input.rpcUrl,
    vaultId,
    config,
    codeHashes: Object.fromEntries(
      roles.map((role, i) => [ids[i], artifacts[role][1]]),
    ),
    daoPolicy,
    factoryInfo: { factory_id: daoId, auto_update: true },
    transactionsEnabled: false,
    authority: `${input.authority} Four contract full-access keys are retained and can replace code. DAO factory is itself, with auto_update=true. Funded simulator; no live lending.`,
  });
  requireThat(
    !new URL(input.rpcUrl).search,
    "Use an RPC endpoint without query credentials",
  );
  const init = {
    token: { owner_id: input.controllerId, total_supply: supply },
    strategy: {
      token_id: tokenId,
      vault_id: vaultId,
      controller_id: input.controllerId,
      loss_sink_id: input.lossSinkId,
    },
    vault: { config },
    dao: {
      config: {
        name: "YieldFund Commons",
        purpose: "Fictional testnet community campaign",
        metadata: "",
      },
      policy: daoPolicy,
    },
  };
  const steps = roles.map((role, i) => ({
    id: `create-${role}`,
    signerId: deployer,
    receiverId: ids[i],
    actions: [
      { type: "CreateAccount" },
      { type: "Transfer", deposit: (contractFunding[role] * near).toString() },
      {
        type: "AddKey",
        publicKey: input.contracts[role].publicKey,
        permission: "FullAccess",
      },
    ],
  }));
  for (const role of ["token", "strategy", "vault", "dao"]) {
    const id = input.contracts[role].accountId;
    steps.push({
      id: `initialize-${role}`,
      signerId: id,
      receiverId: id,
      actions: [
        {
          type: "DeployContract",
          artifact: artifacts[role][0],
          sha256: artifacts[role][1],
        },
        {
          type: "FunctionCall",
          methodName: "new",
          args: init[role],
          gas: "100000000000000",
          deposit: "0",
        },
      ],
    });
  }
  for (const id of new Set([
    ...ids,
    operator,
    deployer,
    ...council,
    input.guardianId,
    input.lossSinkId,
    input.recipientId,
  ])) {
    steps.push({
      id: `register-${id}`,
      signerId: deployer,
      receiverId: tokenId,
      actions: [
        {
          type: "FunctionCall",
          methodName: "storage_deposit",
          args: { account_id: id, registration_only: true },
          gas: "30000000000000",
          deposit: (near / 50n).toString(),
        },
      ],
    });
  }
  const budget = steps
    .flatMap((s) => s.actions)
    .reduce((sum, a) => sum + BigInt(a.deposit ?? "0"), 0n);
  const setup = {
    schemaVersion: 1,
    rpcUrl: input.rpcUrl,
    operatorId: operator,
    deployerId: deployer,
    contracts: Object.fromEntries(
      roles.map((role) => [
        role,
        {
          accountId: input.contracts[role].accountId,
          publicKey: input.contracts[role].publicKey,
        },
      ]),
    ),
    guardianId: input.guardianId,
    controllerId: input.controllerId,
    lossSinkId: input.lossSinkId,
    recipientId: input.recipientId,
    council,
    depositCap: cap,
    totalSupply: supply,
    authority: input.authority,
    metadata: input.metadata,
  };
  return {
    schemaVersion: 1,
    kind: "unsigned-testnet-plan",
    setup,
    manifest,
    metadata: input.metadata,
    metadataCanonical: metadata,
    expectedKeys: Object.fromEntries(
      roles.map((role, i) => [
        ids[i],
        [
          {
            public_key: input.contracts[role].publicKey,
            permission: "FullAccess",
          },
        ],
      ]),
    ),
    actors: {
      operator,
      deployer,
      controller: input.controllerId,
      guardian: input.guardianId,
      council,
      recipient: input.recipientId,
      lossSink: input.lossSinkId,
    },
    totalSupply: supply,
    attachedDepositUpperBound: budget.toString(),
    gasExcluded: true,
    prerequisites: [
      "All actor accounts already exist on testnet and are controlled by the intended people.",
      "All four contract accounts are absent. Check finality immediately before creation.",
      "Review vault/token/strategy/DAO funding of 6/5/4/7 NEAR, registration deposits, gas, public keys and custody before any signature.",
      "DeployContract and new must be one ordered transaction signed by that contract account.",
      "Do not rerun a broadcast with an unknown outcome; inspect finalized receipts first.",
    ],
    steps,
  };
}
export async function auditPlan(plan, transport) {
  requireThat(
    plan.kind === "unsigned-testnet-plan" && plan.schemaVersion === 1,
    "Unsupported plan",
  );
  requireThat(
    canonical(makePlan(plan.setup)) === canonical(plan),
    "Plan differs from reproducible setup; regenerate and review",
  );
  const d = parseDeployment(plan.manifest);
  requireThat(
    d.mode === "chain" && d.network === "testnet" && !d.transactionsEnabled,
    "Audit requires a read-only testnet manifest",
  );
  const ids = [
    d.vaultId,
    d.config.token_id,
    d.config.strategy_id,
    d.config.beneficiary_id,
  ];
  requireThat(
    canonical(Object.keys(plan.expectedKeys).sort()) ===
      canonical([...ids].sort()),
    "Expected keys must cover exactly four contracts",
  );
  for (const [i, role] of roles.entries())
    requireThat(
      d.codeHashes[ids[i]] === artifacts[role][1],
      "Plan must use reviewed normal artifacts",
    );
  const client = new ChainClient(d, transport);
  const snapshot = await client.snapshot();
  const block = snapshot.blockHash;
  const authority = {};
  for (const id of ids) {
    const result = await client.rpc("query", {
      request_type: "view_access_key_list",
      account_id: id,
      block_id: block,
    });
    // No pagination: the RPC fails above 100 keys. Never silently accept a truncated list.
    requireThat(
      result.block_hash === block && Array.isArray(result.keys),
      "Access-key evidence is not from the audited block",
    );
    const expected = plan.expectedKeys[id];
    requireThat(
      Array.isArray(expected) &&
        expected.length === 1 &&
        expected[0].permission === "FullAccess",
      "Expected one explicitly retained full-access key",
    );
    publicKey(expected[0].public_key);
    const observed = result.keys.map((k) => ({
      public_key: k.public_key,
      permission: k.access_key.permission,
    }));
    requireThat(
      canonical(observed) === canonical(expected),
      `Access-key authority changed: ${id}`,
    );
    authority[id] = observed;
  }
  for (const id of new Set([
    ...ids,
    plan.actors.operator,
    plan.actors.deployer,
    plan.actors.controller,
    plan.actors.guardian,
    ...plan.actors.council,
    plan.actors.recipient,
    plan.actors.lossSink,
  ])) {
    testnetId(id);
    await client.rpc("query", {
      request_type: "view_account",
      account_id: id,
      block_id: block,
    });
    const storage = await client.view(
      d.config.token_id,
      "storage_balance_of",
      { account_id: id },
      block,
    );
    requireThat(
      storage &&
        BigInt(raw(storage.total)) >= BigInt(snapshot.tokenStorageCost),
      `Token storage missing: ${id}`,
    );
  }
  const supply = await client.view(
    d.config.token_id,
    "ft_total_supply",
    {},
    block,
  );
  requireThat(raw(supply) === raw(plan.totalSupply), "Unexpected token supply");
  requireThat(
    !snapshot.strategy.busy &&
      !snapshot.accounting.needs_reconciliation &&
      snapshot.accounting.active_operation === null &&
      snapshot.accounting.queued_redemption === null,
    "Resolve outstanding operations before rehearsal",
  );
  return {
    schemaVersion: 1,
    status: "read-only-audit-passed",
    planSha256: sha256(canonical(plan)),
    checkedAt: new Date().toISOString(),
    blockHash: block,
    blockHeight: snapshot.height,
    authority,
    accounting: snapshot.accounting,
    tokenSupply: supply,
    transactionsEnabled: false,
    limitations: [
      "RPC observations are point-in-time, not independent consensus verification.",
      "Public keys do not prove human identity, key custody or three independent council members.",
      "Passing this audit does not authorize signing or enable the app.",
      "Controller/loss-sink bindings are initialized by reviewed actions but not exposed by the current strategy view; retain initialization receipt evidence.",
    ],
  };
}

async function main() {
  const artifactDirectory =
    process.env.YIELDFUND_ARTIFACT_DIRECTORY || "artifacts";
  const [command, inputPath, outputPath, rpcOverride] = process.argv.slice(2);
  requireThat(
    ["plan", "audit", "artifacts", "accounts", "preflight"].includes(command),
    "Usage: npm run deployment -- artifacts | plan INPUT OUTPUT | audit PLAN OUTPUT [RPC_URL] | accounts INPUT OUTPUT [RPC_URL] | preflight PLAN OUTPUT [RPC_URL]",
  );
  requireThat(
    !rpcOverride || ["audit", "accounts", "preflight"].includes(command),
    "RPC override is only for read-only inspections",
  );
  if (command === "artifacts") {
    console.log(
      JSON.stringify(await verifyArtifacts(artifactDirectory), null, 2),
    );
    return;
  }
  requireThat(inputPath && outputPath, "Input and new output paths required");
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const transport = rpcOverride ? readOnlyRpcOverride(rpcOverride) : undefined;
  const output =
    command === "preflight"
      ? await (
          await import("./deployment-preflight.mjs")
        ).preflightPlan(input, { transport, artifactDirectory })
      : command === "accounts"
        ? await inspectAccounts(input, transport)
        : command === "plan"
          ? (await verifyArtifacts(artifactDirectory), makePlan(input))
          : await auditPlan(input, transport);
  if (rpcOverride)
    output.rpcOverride = {
      original: input.manifest?.rpcUrl ?? input.rpcUrl,
      effective: new URL(rpcOverride).href,
    };
  await writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    `Wrote ${outputPath}. No signatures or broadcasts; signing remains disabled.`,
  );
  if (command === "accounts" && !output.allExist) {
    console.error(
      "Some accounts are not created on testnet. See the saved observations.",
    );
    process.exitCode = 2;
  }
  if (command === "preflight" && !output.readyForReview) {
    console.error(
      "Preflight has blockers; no signing is authorized. See the saved report.",
    );
    process.exitCode = 2;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

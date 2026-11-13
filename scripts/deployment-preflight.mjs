import { createHash } from "node:crypto";
import { artifacts, makePlan, verifyArtifacts } from "./deployment.mjs";
import {
  canonical,
  raw,
  requireThat,
} from "../packages/near-client/src/chain.ts";

const NEAR = 10n ** 24n;
const STATE_HEADROOM = 65536n;
// Planning allowance, not a guaranteed fee quote. Final fee depends on execution.
const MAX_GAS_ALLOWANCE = 300_000_000_000_000n;
export function fundingAssessment(
  plan,
  artifactInfo,
  protocol,
  gasPrice,
  deployerAccount,
) {
  const byteCost = BigInt(raw(protocol.runtime_config.storage_amount_per_byte));
  const price = BigInt(raw(gasPrice));
  requireThat(price > 0n && byteCost > 0n, "Invalid protocol fee/storage data");
  requireThat(
    Number.isSafeInteger(deployerAccount.storage_usage) &&
      deployerAccount.storage_usage >= 0,
    "Invalid account storage usage",
  );
  const gasPerTransaction = MAX_GAS_ALLOWANCE * price * 3n;
  const contracts = {};
  for (const role of Object.keys(artifacts)) {
    requireThat(
      Number.isSafeInteger(artifactInfo[role]?.bytes) &&
        artifactInfo[role].bytes > 0,
      "Invalid artifact size",
    );
    const step = plan.steps.find((s) => s.id === `create-${role}`);
    const allocated = BigInt(
      raw(step.actions.find((a) => a.type === "Transfer").deposit),
    );
    const storage =
      (BigInt(artifactInfo[role].bytes) + STATE_HEADROOM) * byteCost;
    const required = storage + gasPerTransaction + NEAR;
    contracts[role] = {
      allocated: allocated.toString(),
      storageWithHeadroom: storage.toString(),
      gasAllowance: gasPerTransaction.toString(),
      operatingReserve: NEAR.toString(),
      required: required.toString(),
      sufficient: allocated >= required,
    };
  }
  const steps = plan.steps.filter((s) => s.signerId === plan.actors.deployer);
  const attached = steps
    .flatMap((s) => s.actions)
    .reduce((n, a) => n + BigInt(a.deposit ?? "0"), 0n);
  const storageLocked = BigInt(deployerAccount.storage_usage) * byteCost;
  const liquid = BigInt(raw(deployerAccount.amount));
  // Ignore staked balance rather than assuming it can fund transactions.
  const available = liquid > storageLocked ? liquid - storageLocked : 0n;
  const gas = BigInt(steps.length) * gasPerTransaction;
  const required = attached + gas + NEAR;
  return {
    byteCost: byteCost.toString(),
    gasPrice: price.toString(),
    gasMultiplier: 3,
    transactionGasAllowance: MAX_GAS_ALLOWANCE.toString(),
    stateHeadroomBytes: STATE_HEADROOM.toString(),
    contracts,
    deployer: {
      accountId: plan.actors.deployer,
      available: available.toString(),
      storageLocked: storageLocked.toString(),
      attachedDeposits: attached.toString(),
      gasAllowance: gas.toString(),
      operatingReserve: NEAR.toString(),
      required: required.toString(),
      shortfall: (required > available ? required - available : 0n).toString(),
    },
  };
}

export async function preflightPlan(
  plan,
  {
    transport = (...args) => fetch(...args),
    artifactDirectory = "artifacts",
  } = {},
) {
  requireThat(
    canonical(makePlan(plan.setup)) === canonical(plan),
    "Plan differs from reproducible setup",
  );
  const artifactInfo = await verifyArtifacts(artifactDirectory);
  async function envelope(method, params) {
    const response = await transport(plan.manifest.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "yieldfund-preflight",
        method,
        params,
      }),
      signal: AbortSignal.timeout(15000),
    });
    requireThat(response.ok, `RPC unavailable (${response.status})`);
    return response.json();
  }
  async function rpc(method, params) {
    const body = await envelope(method, params);
    requireThat(!body.error && body.result, `RPC ${method} failed`);
    return body.result;
  }
  const status = await rpc("status", {});
  requireThat(
    status.chain_id === "testnet" && status.sync_info.syncing === false,
    "Wrong network or syncing",
  );
  const { header } = await rpc("block", { finality: "final" });
  requireThat(
    header?.hash && Number.isSafeInteger(header.height),
    "Invalid final block",
  );
  const stamp = Number(BigInt(header.timestamp_nanosec) / 1000000n);
  requireThat(
    Date.now() - stamp < 120000 && stamp - Date.now() < 30000,
    "Stale finalized block",
  );
  const block = header.hash;
  const [protocol, gas] = await Promise.all([
    rpc("EXPERIMENTAL_protocol_config", { block_id: block }),
    rpc("gas_price", [block]),
  ]);
  requireThat(protocol.chain_id === "testnet", "Wrong protocol network");
  const blockers = [],
    accounts = {},
    keys = {},
    contractAccounts = {};
  const actorIds = [...new Set(Object.values(plan.actors).flat())];
  const contractIds = Object.keys(plan.expectedKeys);
  await Promise.all(
    [...actorIds, ...contractIds].map(async (id) => {
      const body = await envelope("query", {
        request_type: "view_account",
        account_id: id,
        block_id: block,
      });
      if (body.error) {
        const cause = body.error.cause;
        requireThat(
          cause?.name === "UNKNOWN_ACCOUNT" &&
            cause.info?.block_hash === block &&
            cause.info.requested_account_id === id,
          "Account query failed without conclusive absence evidence",
        );
        if (actorIds.includes(id)) {
          blockers.push(`Actor account does not exist: ${id}`);
          accounts[id] = null;
        } else contractAccounts[id] = { status: "absent" };
        return;
      }
      requireThat(
        body.result?.block_hash === block,
        "Account data is from another block",
      );
      if (contractIds.includes(id)) {
        contractAccounts[id] = { status: "exists", account: body.result };
        blockers.push(
          `Contract account already exists: ${id}; inspect prior transactions, do not replay creation`,
        );
        return;
      }
      accounts[id] = body.result;
      const access = await rpc("query", {
        request_type: "view_access_key_list",
        account_id: id,
        block_id: block,
      });
      requireThat(
        access.block_hash === block && Array.isArray(access.keys),
        "Key data is from another block",
      );
      keys[id] = access.keys.map((k) => ({
        public_key: k.public_key,
        permission: k.access_key.permission,
      }));
      if (!keys[id].some((k) => k.permission === "FullAccess"))
        blockers.push(`No supported full-access actor key: ${id}`);
    }),
  );
  requireThat(
    Date.now() - stamp < 120000,
    "Finalized evidence became stale during preflight",
  );
  let funding = null;
  if (accounts[plan.actors.deployer]) {
    funding = fundingAssessment(
      plan,
      artifactInfo,
      protocol,
      gas.gas_price,
      accounts[plan.actors.deployer],
    );
    if (funding.deployer.shortfall !== "0")
      blockers.push(
        `Deployer funding shortfall: ${funding.deployer.shortfall} yoctoNEAR`,
      );
    for (const [role, f] of Object.entries(funding.contracts))
      if (!f.sufficient)
        blockers.push(
          `Insufficient planned ${role} balance for storage, gas and operating reserve`,
        );
  }
  return {
    schemaVersion: 1,
    kind: "read-only-deployment-preflight",
    planSha256: createHash("sha256").update(canonical(plan)).digest("hex"),
    checkedAt: new Date().toISOString(),
    blockHash: block,
    blockHeight: header.height,
    blockTimestampNs: header.timestamp_nanosec,
    protocolVersion: protocol.protocol_version,
    artifactInfo,
    accounts,
    keys,
    contractAccounts,
    funding,
    readyForReview: blockers.length === 0,
    blockers,
    transactionsEnabled: false,
    limitations: [
      "Read-only point-in-time evidence, not signing authorization.",
      "Fee allowances and initial-state headroom are planning estimates; check again before each transaction.",
      "Actor key lists require custody review; this tool does not prove possession or independent council control.",
    ],
  };
}

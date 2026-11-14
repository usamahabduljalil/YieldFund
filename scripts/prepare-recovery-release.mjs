// Read-only preparation. Does not create accounts, read keys, sign or broadcast.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  canonical,
  base58HashHex,
  normalizedPolicy,
} from "../packages/near-client/src/chain.ts";
const rpcUrl = "https://rpc.testnet.fastnear.com";
const base = JSON.parse(await readFile("deployments/testnet.json", "utf8"));
const factory = "yf-v2-factory-261114.testnet",
  token = "yf-v2-token-261114.testnet";
const demo = "yf-v2-demo-261114.testnet",
  builder = "yf-v2-builder-261114.testnet";
const verifier = "yf-verify-261113.testnet",
  dao = base.config.beneficiary_id;
const recipient = JSON.parse(
  await readFile("deployments/testnet-rehearsal.review.json", "utf8"),
).recipient;
const council = base.daoPolicy.roles[0].kind.Group;
const sha = (x) => createHash("sha256").update(x).digest("hex");
async function rpc(method, params) {
  const r = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "recovery-review",
      method,
      params,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(`RPC HTTP ${r.status}`);
  return r.json();
}
const status = await rpc("status", {});
if (status.result?.chain_id !== "testnet") throw Error("Wrong network");
const { result: block } = await rpc("block", { finality: "final" });
if (
  !block ||
  Date.now() - Number(BigInt(block.header.timestamp_nanosec) / 1000000n) >
    120000
)
  throw Error("Stale block");
const query = (type, id) =>
  rpc("query", {
    request_type: type,
    account_id: id,
    block_id: block.header.hash,
  });
async function view(id, method, args = {}) {
  const r = await rpc("query", {
    request_type: "call_function",
    account_id: id,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    block_id: block.header.hash,
  });
  if (r.error) throw Error(`View failed: ${id}.${method}`);
  return JSON.parse(Buffer.from(r.result.result).toString());
}
const availability = {};
for (const id of [factory, token, demo, builder]) {
  const r = await query("view_account", id);
  if (r.error?.cause?.name !== "UNKNOWN_ACCOUNT")
    throw Error(`New account is unavailable or RPC failed: ${id}`);
  availability[id] = "not created; proposed faucet account";
}
const treasuryProposal = await view(dao, "get_last_proposal_id");
const verificationProposal = await view(verifier, "get_last_proposal_id");
const treasuryPolicy = await view(dao, "get_policy");
const verifierPolicy = await view(verifier, "get_policy");
if (normalizedPolicy(treasuryPolicy) !== normalizedPolicy(base.daoPolicy))
  throw Error("Treasury policy changed");
const expectedVerifierPolicy = structuredClone(base.daoPolicy);
expectedVerifierPolicy.roles[0].permissions = [
  "call:AddProposal",
  "call:Finalize",
  "call:VoteApprove",
  "call:VoteReject",
];
if (
  normalizedPolicy(verifierPolicy) !== normalizedPolicy(expectedVerifierPolicy)
)
  throw Error("Verifier policy changed");
const accountEvidence = {};
for (const id of new Set([...council, recipient, dao, verifier])) {
  const r = await query("view_account", id);
  if (r.error) throw Error(`Existing account unavailable: ${id}`);
  accountEvidence[id] = r.result;
}
for (const id of [dao, verifier])
  if (base58HashHex(accountEvidence[id].code_hash) !== base.codeHashes[dao])
    throw Error(`DAO code changed: ${id}`);
const artifacts = {};
for (const file of [
  "yieldfund_vault.wasm",
  "yieldfund_strategy_simulator.wasm",
  "yieldfund_test_token.wasm",
  "yieldfund_campaign_factory.wasm",
]) {
  const bytes = await readFile(`artifacts/${file}`);
  artifacts[file] = { bytes: bytes.length, sha256: sha(bytes) };
}
// Observed from the v2 Sandbox registration, and checked again before deployment.
const fixture = JSON.parse(
  await readFile(
    "docs/evidence/milestone-16-receipts/campaign-factory-sandbox.json",
    "utf8",
  ),
);
const price = 10n ** 19n,
  storage = 2173n * price;
const cost =
  (BigInt(
    artifacts["yieldfund_vault.wasm"].bytes +
      artifacts["yieldfund_strategy_simulator.wasm"].bytes,
  ) +
    12288n) *
    price +
  10n ** 24n +
  storage * 3n;
if (cost.toString() !== fixture.creation_cost)
  throw Error(
    "Sandbox cost differs; rerun final contract tests before preparing review",
  );
const operation = (2048n * price + 1n).toString();
const call = (
  id,
  signerId,
  receiverId,
  methodName,
  args,
  deposit = "0",
  channel = "cli",
) => ({
  id,
  signerId,
  receiverId,
  channel,
  actions: [
    { type: "FunctionCall", methodName, args, deposit, gas: "300000000000000" },
  ],
});
const steps = [
  {
    ...call("deploy-token", token, token, "new", {
      owner_id: demo,
      total_supply: "1000000000000",
    }),
    artifact: "yieldfund_test_token.wasm",
  },
  {
    id: "fund-factory-reserve",
    signerId: token,
    receiverId: factory,
    channel: "cli",
    actions: [{ type: "Transfer", deposit: "3000000000000000000000000" }],
  },
  {
    ...call("deploy-factory", factory, factory, "new", {
      verifier_id: verifier,
      token_id: token,
      token_decimals: 6,
      token_storage: storage.toString(),
    }),
    artifact: "yieldfund_campaign_factory.wasm",
  },
];
const metadata = [];
for (const [id, name, creator] of [
  ["commons", "The Commons", demo],
  ["builders", "Builder Commons", builder],
]) {
  const content = {
    id,
    name,
    beneficiary_id: dao,
    deposit_cap: "1000000000",
    token_id: token,
    disclosure_version: "factory-v2",
  };
  const metadataHash = sha(canonical(content));
  metadata.push({ content, metadataHash });
  steps.push(
    call(
      `create-${id}`,
      creator,
      factory,
      "create_campaign",
      {
        id,
        name,
        beneficiary_id: dao,
        metadata_hash: metadataHash,
        deposit_cap: content.deposit_cap,
      },
      cost.toString(),
      id === "builders" ? "browser-wallet" : "cli",
    ),
  );
}
const vault = `v-commons.${factory}`,
  strategy = `s-commons.${factory}`;
steps.push(
  call(
    "register-position",
    demo,
    vault,
    "storage_deposit",
    { account_id: demo },
    (512n * price).toString(),
    "browser-wallet",
  ),
  call(
    "deposit",
    demo,
    token,
    "ft_transfer_call",
    { receiver_id: vault, amount: "100000000", msg: "deposit" },
    "1",
    "browser-wallet",
  ),
  call(
    "allocate",
    demo,
    vault,
    "allocate_idle",
    { amount: "100000000" },
    operation,
    "browser-wallet",
  ),
  call(
    "fund-profit",
    demo,
    token,
    "ft_transfer_call",
    { receiver_id: strategy, amount: "3000000", msg: "fund_profit" },
    "1",
  ),
  call(
    "redeem",
    demo,
    vault,
    "redeem_strategy",
    {},
    operation,
    "browser-wallet",
  ),
  call(
    "donate",
    demo,
    vault,
    "distribute_yield",
    { max_amount: "3000000" },
    operation,
    "browser-wallet",
  ),
  call(
    "request-withdrawal",
    demo,
    vault,
    "request_withdraw",
    { units: "20000000", min_amount: "20000000" },
    operation,
    "browser-wallet",
  ),
  call(
    "advance-withdrawal",
    demo,
    vault,
    "advance_operation",
    { operation_id: "4" },
    "1",
    "browser-wallet",
  ),
  call(
    "register-recipient",
    demo,
    token,
    "storage_deposit",
    { account_id: recipient, registration_only: true },
    storage.toString(),
  ),
);
const transfer = {
  Transfer: {
    token_id: token,
    receiver_id: recipient,
    amount: "2000000",
    msg: null,
  },
};
steps.push(
  call(
    "propose-payment",
    council[0],
    dao,
    "add_proposal",
    {
      proposal: {
        description: "YieldFund v2 demo community payment",
        kind: transfer,
      },
    },
    treasuryPolicy.proposal_bond,
  ),
);
for (const [i, actor] of council.slice(0, 2).entries())
  steps.push(
    call(`vote-payment-${i + 1}`, actor, dao, "act_proposal", {
      id: treasuryProposal,
      action: "VoteApprove",
      proposal: transfer,
    }),
  );
const attestation = {
  id: "commons",
  metadata_hash: metadata[0].metadataHash,
  evidence_hash: sha(
    canonical({
      scope: "v2 funded testnet simulator",
      metadata: metadata[0],
      artifacts,
    }),
  ),
  expires_at: String(BigInt(Date.parse("2026-12-01T00:00:00Z")) * 1000000n),
};
const verify = {
  FunctionCall: {
    receiver_id: factory,
    actions: [
      {
        method_name: "verify_campaign",
        args: Buffer.from(JSON.stringify(attestation)).toString("base64"),
        deposit: "1",
        gas: "30000000000000",
      },
    ],
  },
};
steps.push(
  call(
    "propose-verification",
    council[0],
    verifier,
    "add_proposal",
    { proposal: { description: "Verify campaign commons", kind: verify } },
    verifierPolicy.proposal_bond,
    "browser-wallet",
  ),
);
for (const [i, actor] of council.slice(0, 2).entries())
  steps.push(
    call(
      `vote-verification-${i + 1}`,
      actor,
      verifier,
      "act_proposal",
      { id: verificationProposal, action: "VoteApprove", proposal: verify },
      "0",
      "browser-wallet",
    ),
  );
// Match the application's exact DAO call builders, including prepaid gas.
for (const step of steps)
  for (const action of step.actions) {
    if (action.methodName === "add_proposal") action.gas = "100000000000000";
    if (action.methodName === "act_proposal") action.gas = "250000000000000";
  }
const plan = {
  schemaVersion: 2,
  network: "testnet",
  rpcUrl,
  approvalStatus: "awaiting user approval",
  accounts: availability,
  faucetFundingPerAccount: "10000000000000000000000000",
  gasAllowance: "750000000000000000000000",
  factoryId: factory,
  tokenId: token,
  verifierId: verifier,
  creationCost: cost.toString(),
  tokenStorage: storage.toString(),
  artifacts,
  metadata,
  steps,
};
await writeFile(
  "deployments/recovery-release.review.json",
  JSON.stringify(plan, null, 2) + "\n",
);
await writeFile(
  "docs/evidence/milestone-16-release-preflight.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      network: "testnet",
      blockHeight: block.header.height,
      blockHash: block.header.hash,
      availability,
      accountEvidence,
      treasuryProposal,
      verificationProposal,
      reviewSha256: sha(canonical(plan)),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    steps: steps.length,
    creationCost: cost.toString(),
    tokenStorage: storage.toString(),
    reviewSha256: sha(canonical(plan)),
  }),
);

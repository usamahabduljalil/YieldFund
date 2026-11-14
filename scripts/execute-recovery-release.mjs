// Exact approved v2 execution; browser steps are collected, never silently run via CLI.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, createPublicKey, verify } from "node:crypto";
import { canonical } from "../packages/near-client/src/chain.ts";
import {
  REVIEW,
  plan,
  out,
  json,
  assert,
  exists,
  save,
  rpc,
  freshBlock,
  query,
  view,
  audit,
} from "./recovery-release-tools.mjs";
const sha = (b) => createHash("sha256").update(b).digest();
const [id, approval, mode, browserHash] = process.argv.slice(2);
assert(
  approval === "--approved-testnet-v2",
  "Explicit approved plan flag required",
);
const index = plan.steps.findIndex((s) => s.id === id);
assert(index >= 0, "Unknown step");
const step = plan.steps[index],
  dir = "artifacts/recovery-release-signing";
await mkdir(dir, { recursive: true });
await mkdir(out, { recursive: true });
const path = resolve(dir, id),
  receiptPath = `${out}/${id}.json`;
const recorded = await exists(receiptPath);
if (recorded) {
  const r = await json(receiptPath);
  assert(r.reviewSha256 === REVIEW, "Record mismatch");
  if (!(await exists(`${out}/${id}.audit.json`)))
    await save(`${out}/${id}.audit.json`, await audit(index));
  console.log(
    JSON.stringify({
      id,
      hash: r.hash,
      status: "already finalized and audited; no replay",
    }),
  );
  process.exit(0);
}
const collecting = mode === "--collect-browser";
assert(
  collecting || mode === undefined || mode === "--preflight-browser",
  "Unsupported execution mode",
);
assert(
  step.channel === "browser-wallet" ? !!mode : !mode,
  "Use the reviewed execution channel",
);
const recovering = await exists(`${path}.journal.json`);
let spent = 0n;
for (const prior of plan.steps.slice(0, index)) {
  const receipt = await json(`${out}/${prior.id}.json`);
  assert(
    receipt.verification === "finalized-success" &&
      receipt.reviewSha256 === REVIEW,
    "Previous receipt unresolved",
  );
  await json(`${out}/${prior.id}.audit.json`);
  spent += BigInt(receipt.tokensBurnt);
}
const block = await freshBlock();
const expected =
  (await json("docs/evidence/milestone-16-accounts.json")).accounts[
    step.signerId
  ]?.keys.keys ??
  (await json("deployments/campaign-release.review.json")).accounts[
    step.signerId
  ].keys.keys;
const keys = await query("view_access_key_list", step.signerId, block);
assert(
  canonical(
    keys.keys.map((k) => ({
      public_key: k.public_key,
      permission: k.access_key.permission,
    })),
  ) ===
    canonical(
      expected.map((k) => ({
        public_key: k.public_key,
        permission: k.access_key.permission,
      })),
    ),
  "Signer authority changed",
);
const price = BigInt(
  (await rpc("gas_price", { block_id: block.hash })).gas_price,
);
const maxStepFee = 330000000000000n * price;
assert(
  spent + maxStepFee * BigInt(plan.steps.length - index) <=
    BigInt(plan.gasAllowance),
  "Remaining gas cap insufficient",
);
if (!recovering && !collecting) {
  await audit(index - 1, block);
  const account = await query("view_account", step.signerId, block);
  const storagePrice = BigInt(
    (await rpc("EXPERIMENTAL_protocol_config", { block_id: block.hash }))
      .runtime_config.storage_amount_per_byte,
  );
  const deposit = step.actions.reduce((n, a) => n + BigInt(a.deposit), 0n);
  assert(
    BigInt(account.amount) >=
      BigInt(account.storage_usage) * storagePrice + deposit + maxStepFee * 10n,
    "Insufficient admission reserve",
  );
  if (step.artifact) {
    const bytes = await readFile(resolve("artifacts", step.artifact));
    assert(
      sha(bytes).toString("hex") === plan.artifacts[step.artifact].sha256,
      "Artifact changed",
    );
    assert(
      account.code_hash === "11111111111111111111111111111111",
      "Deployment target has code",
    );
    assert(
      BigInt(account.amount) >
        (BigInt(bytes.length) + 65536n) * storagePrice + maxStepFee,
      "Insufficient code storage reserve",
    );
  }
  const action = step.actions[0];
  if (action.methodName === "create_campaign") {
    assert(
      (await view(plan.factoryId, "creation_cost", {}, block)) ===
        plan.creationCost,
      "Creation cost changed",
    );
    assert(
      (await view(
        plan.factoryId,
        "get_campaign",
        { id: action.args.id },
        block,
      )) === null,
      "Campaign already exists",
    );
  }
  if (action.methodName === "add_proposal") {
    assert(
      (await view(step.receiverId, "get_last_proposal_id", {}, block)) ===
        plan.steps[index + 1].actions[0].args.id,
      "Proposal ID changed",
    );
  }
  if (action.methodName === "act_proposal") {
    const proposal = await view(
      step.receiverId,
      "get_proposal",
      { id: action.args.id },
      block,
    );
    assert(
      proposal.status === "InProgress" &&
        !proposal.votes[step.signerId] &&
        canonical(proposal.kind) === canonical(action.args.proposal),
      "Proposal changed",
    );
  }
}
if (mode === "--preflight-browser") {
  await writeFile(
    `${path}.browser-preflight.json`,
    JSON.stringify({
      id,
      reviewSha256: REVIEW,
      block,
      checkedAt: new Date().toISOString(),
    }),
  );
  console.log(JSON.stringify({ id, ready: true, call: step }));
  process.exit(0);
}
let hash, journal;
if (collecting) {
  assert(
    /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(browserHash),
    "Expected browser transaction hash",
  );
  const preflight = await json(`${path}.browser-preflight.json`);
  assert(preflight.reviewSha256 === REVIEW, "Browser preflight missing");
  hash = browserHash;
  journal = {
    id,
    hash,
    signerId: step.signerId,
    receiverId: step.receiverId,
    reviewSha256: REVIEW,
    channel: "browser-wallet",
    savedAt: new Date().toISOString(),
  };
  if (!recovering) await save(`${path}.journal.json`, journal);
  else
    assert(
      (await json(`${path}.journal.json`)).hash === hash,
      "Conflicting browser hash",
    );
} else {
  if (!(await exists(`${path}.signed.json`))) {
    assert(!recovering, "Missing signed bytes; reconcile existing hash");
    const a = step.actions[0];
    let args;
    if (a.type === "Transfer")
      args = [
        "tokens",
        step.signerId,
        "send-near",
        step.receiverId,
        `${a.deposit} yoctoNEAR`,
      ];
    else {
      await writeFile(`${path}.args.json`, JSON.stringify(a.args));
      args = step.artifact
        ? [
            "contract",
            "deploy",
            step.receiverId,
            "use-file",
            resolve("artifacts", step.artifact),
            "with-init-call",
            a.methodName,
            "file-args",
            `${path}.args.json`,
          ]
        : [
            "contract",
            "call-function",
            "as-transaction",
            step.receiverId,
            a.methodName,
            "file-args",
            `${path}.args.json`,
          ];
      args.push(
        "prepaid-gas",
        `${BigInt(a.gas) / 1000000000000n} Tgas`,
        "attached-deposit",
        `${a.deposit} yoctoNEAR`,
      );
      if (!step.artifact) args.push("sign-as", step.signerId);
    }
    args.push(
      "network-config",
      "testnet",
      "sign-with-keychain",
      "--signer-public-key",
      expected[0].public_key,
      "save-to-file",
      `${path}.signed.json`,
    );
    assert(process.env.YIELDFUND_NEAR_CLI, "Set installed CLI path");
    try {
      await promisify(execFile)(process.env.YIELDFUND_NEAR_CLI, args, {
        windowsHide: true,
        timeout: 50000,
        maxBuffer: 2000000,
      });
    } catch {
      assert(
        await exists(`${path}.signed.json`),
        "CLI did not save signed transaction",
      );
    }
  }
  const signed = await json(`${path}.signed.json`),
    b = Buffer.from(signed.signed_transaction_as_base64, "base64");
  let p = 0;
  const take = (n) => {
    assert(p + n <= b.length, "Truncated payload");
    const x = b.subarray(p, p + n);
    p += n;
    return x;
  };
  const u8 = () => take(1)[0],
    u32 = () => take(4).readUInt32LE(),
    u64 = () => take(8).readBigUInt64LE(),
    str = () => take(u32()).toString();
  const u128 = () => {
    const x = take(16);
    return x.readBigUInt64LE() + (x.readBigUInt64LE(8) << 64n);
  };
  function base58(bytes) {
    const alphabet =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = BigInt("0x" + bytes.toString("hex")),
      s = "";
    while (n) {
      s = alphabet[Number(n % 58n)] + s;
      n /= 58n;
    }
    for (const x of bytes) {
      if (x !== 0) break;
      s = "1" + s;
    }
    return s;
  }
  const signerId = str();
  assert(u8() === 0, "Only reviewed ed25519 keys supported");
  const publicBytes = take(32),
    publicKey = "ed25519:" + base58(publicBytes),
    nonce = String(u64()),
    receiverId = str(),
    blockHash = base58(take(32)),
    count = u32(),
    actions = [];
  for (let i = 0; i < count; i++) {
    const kind = u8();
    if (kind === 1) {
      actions.push({
        type: "DeployContract",
        sha256: sha(take(u32())).toString("hex"),
      });
    } else if (kind === 2) {
      actions.push({
        type: "FunctionCall",
        methodName: str(),
        args: JSON.parse(str()),
        gas: String(u64()),
        deposit: String(u128()),
      });
    } else if (kind === 3) {
      actions.push({ type: "Transfer", deposit: String(u128()) });
    } else throw Error("Unreviewed signed action");
  }
  const unsigned = b.subarray(0, p);
  hash = base58(sha(unsigned));
  assert(u8() === 0, "Signature type");
  const signature = take(64);
  assert(p === b.length, "Trailing bytes");
  assert(
    verify(
      null,
      sha(unsigned),
      createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          publicBytes,
        ]),
        format: "der",
        type: "spki",
      }),
      signature,
    ),
    "Signature invalid",
  );
  const expectedActions = [
    ...(step.artifact
      ? [
          {
            type: "DeployContract",
            sha256: plan.artifacts[step.artifact].sha256,
          },
        ]
      : []),
    ...step.actions,
  ];
  assert(
    signerId === step.signerId &&
      receiverId === step.receiverId &&
      publicKey === expected[0].public_key &&
      canonical(actions) === canonical(expectedActions),
    "Signed bytes differ from reviewed calls",
  );

  journal = {
    id,
    hash,
    signerId,
    receiverId,
    publicKey,
    nonce,
    blockHash,
    actions,
    reviewSha256: REVIEW,
    channel: "cli",
    savedAt: new Date().toISOString(),
  };
  if (!recovering) {
    await save(`${path}.journal.json`, journal);
    const endpoint = "https://archival-rpc.testnet.fastnear.com";
    assert(
      (await rpc("status", {}, endpoint)).chain_id === "testnet",
      "Broadcast network changed",
    );
    await rpc(
      "broadcast_tx_commit",
      [signed.signed_transaction_as_base64],
      endpoint,
    );
  } else
    assert(
      (await json(`${path}.journal.json`)).hash === hash,
      "Journal mismatch",
    );
}
const result = await rpc(
  "tx",
  { tx_hash: hash, sender_account_id: step.signerId, wait_until: "FINAL" },
  "https://archival-rpc.testnet.fastnear.com",
);
assert(
  result.final_execution_status === "FINAL" && result.transaction.hash === hash,
  "Not finalized",
);
// RPC ActionView encodes the deploy code digest, while signed bytes contain Wasm.
function rpcDeploymentHash(code) {
  const bytes = Buffer.from(code, "base64");
  return bytes.length === 32
    ? bytes.toString("hex")
    : sha(bytes).toString("hex");
}
const actions = result.transaction.actions.map((a) =>
  a.FunctionCall
    ? {
        type: "FunctionCall",
        methodName: a.FunctionCall.method_name,
        args: JSON.parse(Buffer.from(a.FunctionCall.args, "base64").toString()),
        gas: String(a.FunctionCall.gas),
        deposit: a.FunctionCall.deposit,
      }
    : a.Transfer
      ? { type: "Transfer", deposit: a.Transfer.deposit }
      : a.DeployContract
        ? {
            type: "DeployContract",
            sha256: rpcDeploymentHash(a.DeployContract.code),
          }
        : a,
);
const expectedActions = [
  ...(step.artifact
    ? [{ type: "DeployContract", sha256: plan.artifacts[step.artifact].sha256 }]
    : []),
  ...step.actions,
];
assert(
  result.transaction.signer_id === step.signerId &&
    result.transaction.receiver_id === step.receiverId &&
    result.transaction.public_key === expected[0].public_key &&
    canonical(actions) === canonical(expectedActions),
  "Finalized call differs from review",
);
const outcomes = [result.transaction_outcome, ...result.receipts_outcome],
  success = (s) =>
    s &&
    (Object.hasOwn(s, "SuccessValue") || Object.hasOwn(s, "SuccessReceiptId"));
assert(
  success(result.status) && outcomes.every((o) => success(o.outcome.status)),
  "A receipt failed; stop and reconcile",
);
const map = new Map(outcomes.map((o) => [o.id, o])),
  seen = new Set();
function visit(o) {
  if (seen.has(o.id)) return;
  seen.add(o.id);
  for (const id of o.outcome.receipt_ids) {
    assert(map.has(id), "Missing receipt");
    visit(map.get(id));
  }
}
visit(result.transaction_outcome);
assert(seen.size === outcomes.length, "Detached receipts");
const tokensBurnt = String(
  outcomes.reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n),
);
assert(
  spent + BigInt(tokensBurnt) <= BigInt(plan.gasAllowance),
  "Fee cap exceeded",
);
await save(receiptPath, {
  ...journal,
  verification: "finalized-success",
  tokensBurnt,
  result,
});
await save(`${out}/${id}.audit.json`, await audit(index));
console.log(
  JSON.stringify({
    id,
    hash,
    tokensBurnt,
    verification: "finalized-success and state audited",
  }),
);

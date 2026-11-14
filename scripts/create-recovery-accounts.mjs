// Execute only the four faucet account creations in the approved v2 review.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { releaseDigest } from "./public-release.mjs";
const reviewSha256 =
  "6d55bbccf4108a7bc6c8ac362c965ac4409b7695f4f122b07803d0aaed75bec5";
const plan = JSON.parse(
  await readFile("deployments/recovery-release.review.json", "utf8"),
);
if (
  releaseDigest(plan) !== reviewSha256 ||
  process.argv[2] !== "--approved-testnet-v2"
)
  throw Error("Exact approved review required");
if (!process.env.YIELDFUND_NEAR_CLI)
  throw Error("Set the installed NEAR CLI path");
const folder = "artifacts/recovery-release-signing";
await mkdir(folder, { recursive: true });
async function rpc(method, params) {
  const response = await fetch(plan.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "v2-accounts", method, params }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  return response.json();
}
if ((await rpc("status", {})).result?.chain_id !== "testnet")
  throw Error("Wrong network");
for (const id of Object.keys(plan.accounts)) {
  const before = await rpc("query", {
    request_type: "view_account",
    account_id: id,
    finality: "final",
  });
  if (before.result) {
    console.log(`${id}: already exists; inspecting only`);
    continue;
  }
  if (before.error?.cause?.name !== "UNKNOWN_ACCOUNT")
    throw Error(`Uncertain account status: ${id}`);
  // Never auto-repeat an interrupted faucet request or generate another key for it.
  await writeFile(
    `${folder}/${id}.creation-attempt.json`,
    JSON.stringify({ id, reviewSha256, startedAt: new Date().toISOString() }),
    { flag: "wx" },
  );
  let succeeded = false,
    transactionHash = null;
  try {
    const result = await promisify(execFile)(
      process.env.YIELDFUND_NEAR_CLI,
      [
        "account",
        "create-account",
        "sponsor-by-faucet-service",
        id,
        "autogenerate-new-keypair",
        "save-to-keychain",
        "network-config",
        "testnet",
        "create",
      ],
      { windowsHide: true, timeout: 50000, maxBuffer: 1000000 },
    );
    succeeded = true;
    transactionHash =
      `${result.stdout}\n${result.stderr}`.match(
        /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/,
      )?.[1] ?? null;
  } catch {
    /* Inspect finalized state; never equate a transport error with failure. */
  }
  await writeFile(
    `${folder}/${id}.creation-result.json`,
    JSON.stringify({
      id,
      succeeded,
      transactionHash,
      checkedAt: new Date().toISOString(),
    }),
  );
  console.log(
    JSON.stringify({ id, cliReturnedSuccess: succeeded, transactionHash }),
  );
}
const block = (await rpc("block", { finality: "final" })).result;
const accounts = {};
for (const id of Object.keys(plan.accounts)) {
  const account = await rpc("query", {
    request_type: "view_account",
    account_id: id,
    block_id: block.header.hash,
  });
  const keys = await rpc("query", {
    request_type: "view_access_key_list",
    account_id: id,
    block_id: block.header.hash,
  });
  if (
    !account.result ||
    !keys.result ||
    keys.result.keys.length !== 1 ||
    keys.result.keys[0].access_key.permission !== "FullAccess" ||
    account.result.amount !== plan.faucetFundingPerAccount ||
    account.result.code_hash !== "11111111111111111111111111111111"
  )
    throw Error(`Account funding/authority mismatch: ${id}`);
  accounts[id] = {
    account: account.result,
    keys: keys.result,
    creation: JSON.parse(
      await readFile(`${folder}/${id}.creation-result.json`, "utf8"),
    ),
  };
}
await writeFile(
  "docs/evidence/milestone-16-accounts.json",
  JSON.stringify({ reviewSha256, block: block.header, accounts }, null, 2) +
    "\n",
  { flag: "wx" },
);
console.log(
  "All four finalized faucet accounts hold 10 testnet NEAR and one full-access key.",
);

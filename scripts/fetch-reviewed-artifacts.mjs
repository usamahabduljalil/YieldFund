// Recover immutable historical test fixtures from public code; verify every byte.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { artifacts } from "./deployment.mjs";
const deployment = JSON.parse(
  await readFile("deployments/testnet.json", "utf8"),
);
const ids = {
  vault: deployment.vaultId,
  token: deployment.config.token_id,
  strategy: deployment.config.strategy_id,
  dao: deployment.config.beneficiary_id,
};
const directory = "tests/fixtures/reviewed-testnet";
await mkdir(directory, { recursive: true });
for (const [role, [name, hash]] of Object.entries(artifacts)) {
  const response = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "reviewed-code",
      method: "query",
      params: {
        request_type: "view_code",
        account_id: ids[role],
        finality: "final",
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (!body.result?.code_base64)
    throw new Error(`Code unavailable for ${role}`);
  const bytes = Buffer.from(body.result.code_base64, "base64");
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error(`Historical hash mismatch: ${role}`);
  await writeFile(`${directory}/${name}`, bytes);
  console.log(`${role}: verified ${bytes.length} bytes`);
}

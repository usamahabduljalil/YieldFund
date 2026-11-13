// Publish only the read-only, public testnet configuration. No credentials.
import { readFile, writeFile } from "node:fs/promises";
import { parseDeployment } from "../packages/near-client/src/chain.ts";
const deployment = parseDeployment(
  JSON.parse(
    await readFile(
      new URL("../deployments/testnet.json", import.meta.url),
      "utf8",
    ),
  ),
);
if (
  deployment.mode !== "chain" ||
  deployment.network !== "testnet" ||
  deployment.transactionsEnabled
)
  throw new Error("Hosting requires the read-only testnet manifest");
await writeFile(
  new URL("../apps/web/dist/client/deployment.json", import.meta.url),
  JSON.stringify(deployment, null, 2) + "\n",
);
console.log("Hosted runtime: public testnet reads; signing disabled.");

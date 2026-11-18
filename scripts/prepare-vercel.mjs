// Public configuration only. Signing additionally requires reviewed acceptance.
import { readFile, writeFile } from "node:fs/promises";
import { parseDeployment } from "../packages/near-client/src/chain.ts";
import { validatePublicRelease } from "./public-release.mjs";
async function readJson(path, optional = false) {
  try {
    return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return undefined;
    throw error;
  }
}
const deployment = parseDeployment(
  (await readJson("../deployments/public-runtime.json", true)) ??
    (await readJson("../deployments/testnet.json")),
);
const registry = await readJson("../apps/web/public/registry.json");
const mode = validatePublicRelease(
  deployment,
  registry,
  await readJson("../deployments/public-signing-acceptance.json", true),
  await readJson("../deployments/recovery-release.review.json", true),
);
await writeFile(
  new URL("../apps/web/dist/client/deployment.json", import.meta.url),
  JSON.stringify(deployment, null, 2) + "\n",
);
console.log(`Hosted runtime: public ${deployment.network}; ${mode}.`);

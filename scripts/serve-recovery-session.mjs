// Loopback-only approved v2 wallet rehearsal; never changes public manifests.
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { parseDeployment } from "../packages/near-client/src/chain.ts";
import {
  REVIEW,
  plan,
  out,
  json,
  assert,
  audit,
} from "./recovery-release-tools.mjs";
assert(
  process.argv[2] === "--approved-testnet-v2",
  "Approved rehearsal flag required",
);
assert(
  (await json("deployments/recovery-release.approval.json")).reviewSha256 ===
    REVIEW,
  "Approval mismatch",
);
for (const step of plan.steps.slice(0, 4)) {
  const r = await json(`${out}/${step.id}.json`);
  assert(
    r.reviewSha256 === REVIEW && r.verification === "finalized-success",
    "Initial deployments incomplete",
  );
  await json(`${out}/${step.id}.audit.json`);
}
// Use the latest completed step so this launcher can resume the same rehearsal.
let last = 3;
for (let i = 4; i < plan.steps.length; i++) {
  try {
    const r = await json(`${out}/${plan.steps[i].id}.json`);
    if (r.verification !== "finalized-success") break;
    last = i;
  } catch (error) {
    if (error.code === "ENOENT") break;
    throw error;
  }
}
const evidence = await audit(last),
  base = await json("deployments/testnet.json");
const commons = evidence.campaigns.find((c) => c.campaign.id === "commons");
const d = parseDeployment({
  ...base,
  displayName: "The Commons v2",
  rpcUrl: plan.rpcUrl,
  vaultId: commons.campaign.vault_id,
  config: commons.config,
  transactionsEnabled: true,
  codeHashes: {
    [commons.campaign.vault_id]: plan.artifacts["yieldfund_vault.wasm"].sha256,
    [commons.campaign.strategy_id]:
      plan.artifacts["yieldfund_strategy_simulator.wasm"].sha256,
    [plan.tokenId]: plan.artifacts["yieldfund_test_token.wasm"].sha256,
    [base.config.beneficiary_id]: base.codeHashes[base.config.beneficiary_id],
  },
  authority:
    "Testnet rehearsal with a funded simulator and custom receipt-enabled test token. Child vault/strategy accounts are keyless. Creator controls bounded operations. Token/factory/DAO full-access keys are retained and can replace code. Demo actors and all council keys share this machine's custody; they are not independent people. No live Rhea yield or mainnet deposits.",
});
const registry = {
  deployments: [
    {
      network: "testnet",
      chainId: "testnet",
      rpcUrl: plan.rpcUrl,
      recoveryVersion: 2,
      factoryId: plan.factoryId,
      factoryCodeHash: plan.artifacts["yieldfund_campaign_factory.wasm"].sha256,
      verifierId: plan.verifierId,
      verifierCodeHash: base.codeHashes[base.config.beneficiary_id],
      tokenId: plan.tokenId,
      tokenDecimals: 6,
      vaultCodeHash: plan.artifacts["yieldfund_vault.wasm"].sha256,
      strategyCodeHash:
        plan.artifacts["yieldfund_strategy_simulator.wasm"].sha256,
      transactionsEnabled: true,
    },
  ],
};
await writeFile(
  "artifacts/recovery-release-signing/runtime.json",
  JSON.stringify(d, null, 2),
);
await writeFile(
  "artifacts/recovery-release-signing/registry.json",
  JSON.stringify(registry, null, 2),
);
const route = "/deployment.v2-session.json",
  root = process.cwd();
const server = await createServer({
  root: resolve(root, "apps/web"),
  configFile: resolve(root, "apps/web/vite.config.mjs"),
  define: { "import.meta.env.VITE_DEPLOYMENT_URL": JSON.stringify(route) },
  server: { host: "127.0.0.1", port: 4178, strictPort: true, allowedHosts: [] },
  plugins: [
    {
      name: "approved-v2-loopback",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const path = req.url?.split("?")[0],
            value =
              path === route ? d : path === "/registry.json" ? registry : null;
          if (!value) return next();
          if (!["GET", "HEAD"].includes(req.method)) {
            res.writeHead(405);
            return res.end();
          }
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(req.method === "HEAD" ? undefined : JSON.stringify(value));
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `Approved v2 wallet rehearsal: http://127.0.0.1:4178/app; review ${REVIEW}. Public signing remains unchanged.`,
);

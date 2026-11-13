// Local public-testnet session. No credentials or transaction executor.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createServer } from "vite";
import {
  canonical,
  parseDeployment,
} from "../packages/near-client/src/chain.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployment = parseDeployment(
  JSON.parse(await readFile(resolve(root, "deployments/testnet.json"), "utf8")),
);
if (
  deployment.mode !== "chain" ||
  deployment.network !== "testnet" ||
  deployment.transactionsEnabled
)
  throw new Error("This launcher requires a read-only testnet manifest.");
const reviewHash =
  "efb048ff9da1a00cecdf92fae98306cdbf15fe4f8f9376c1f1b95833cdaa79ff";
const args = process.argv.slice(2);
const rehearsal =
  args.length === 2 &&
  args[0] === "--approved-rehearsal" &&
  args[1] === reviewHash;
const readOnlyRehearsal =
  args.length === 1 && args[0] === "--read-only-rehearsal";
if (args.length && !rehearsal && !readOnlyRehearsal)
  throw new Error("Use the exact approved rehearsal SHA-256.");
if (rehearsal) {
  const read = async (name) =>
    JSON.parse(await readFile(resolve(root, name), "utf8"));
  const review = await read("deployments/testnet-rehearsal.review.json");
  const preflight = await read(
    "docs/evidence/milestone-9-session-preflight.json",
  ).catch(() => read("docs/evidence/milestone-9-approved-preflight.json"));
  const hash = (value) =>
    createHash("sha256").update(canonical(value)).digest("hex");
  const age = Date.now() - Date.parse(preflight.checkedAt);
  if (
    hash(review) !== reviewHash ||
    hash(deployment) !== review.deploymentSha256 ||
    preflight.reviewSha256 !== reviewHash ||
    preflight.authorizedBy !== "User: yes approve" ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 3600000
  )
    throw new Error("Approved review and fresh successful preflight required.");
  deployment.transactionsEnabled = true;
}
const port = rehearsal || readOnlyRehearsal ? 4176 : 4175;
const route = "/deployment.testnet-session.json";
const server = await createServer({
  root: resolve(root, "apps/web"),
  configFile: resolve(root, "apps/web/vite.config.mjs"),
  define: { "import.meta.env.VITE_DEPLOYMENT_URL": JSON.stringify(route) },
  server: { host: "127.0.0.1", port, strictPort: true, allowedHosts: [] },
  plugins: [
    {
      name: "yieldfund-read-only-testnet-session",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== route) return next();
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { Allow: "GET, HEAD" });
            return res.end();
          }
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(
            req.method === "HEAD" ? undefined : JSON.stringify(deployment),
          );
        });
      },
    },
  ],
});
await server.listen();
console.log(
  `${rehearsal ? "Approved rehearsal" : "Read-only"} NEAR testnet: http://127.0.0.1:${port}/app`,
);
console.log(
  rehearsal
    ? `Local signing enabled for reviewed rehearsal ${reviewHash}. Stop this server when finished.`
    : "Default preview and production configuration are unchanged. No signing enabled.",
);

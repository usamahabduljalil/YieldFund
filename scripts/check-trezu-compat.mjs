// Executes Trezu's pinned, unmodified schema against our generated templates.
// npm install --prefix artifacts/trezu-compat --save-exact zod@4.4.3
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  verificationTemplates,
  rheaOperationTemplates,
  TREZU_REVISION,
} from "../packages/near-client/src/trezu.ts";
const source = execFileSync(
  "git",
  [
    "-C",
    "artifacts/integration-sources/trezu",
    "show",
    `${TREZU_REVISION}:nt-fe/features/proposal-templates/manifest.ts`,
  ],
  { encoding: "utf8" },
);
await mkdir("artifacts/trezu-compat", { recursive: true });
await writeFile("artifacts/trezu-compat/manifest.ts", source);
const { parseManifest } = await import(
  pathToFileURL(resolve("artifacts/trezu-compat/manifest.ts")).href
);
const manifests = [
  ...verificationTemplates("factory.near"),
  ...rheaOperationTemplates("vault.near", "20480000000000000000001"),
];
for (const manifest of manifests) {
  const result = parseManifest(manifest);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
}
const evidence = {
  checkedAt: new Date().toISOString(),
  revision: TREZU_REVISION,
  schemaSha256: createHash("sha256").update(source).digest("hex"),
  zod: "4.4.3",
  accepted: manifests.map((m) => m.id),
  fixturesOnly: true,
  liveTrezuInstallation: false,
  signatures: 0,
  broadcasts: 0,
};
await writeFile(
  "docs/evidence/trezu-template-compat.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence, null, 2));

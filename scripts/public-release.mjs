import { createHash } from "node:crypto";

const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}
export const releaseDigest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export const acceptanceChecks = [
  "deployedArtifactsAndAuthority",
  "finalizedLifecycleAndBalances",
  "browserCampaignCreation",
  "browserVaultLifecycle",
  "browserDaoVerification",
  "walletTransactionCancellation",
  "staleAccountAndNetworkReview",
  "refreshAndReceiptRecovery",
];

// This is a reviewed-evidence build guard, not an independent chain audit.
export function validatePublicRelease(
  deployment,
  registry,
  acceptance,
  review,
) {
  const fail = (message) => {
    throw new Error(`Public release: ${message}`);
  };
  if (
    deployment.mode !== "chain" ||
    !["testnet", "mainnet"].includes(deployment.network)
  )
    fail("unsupported hosted network");
  if (!Array.isArray(registry.deployments))
    fail("missing registry deployments");
  const enabled = registry.deployments.filter((d) => d.transactionsEnabled);
  if (deployment.network === "mainnet") {
    if (
      deployment.strategyMode !== "rhea_lending" ||
      deployment.transactionsEnabled ||
      enabled.length
    )
      fail(
        "mainnet Rhea requires read-only manifests until live release acceptance",
      );
    return "read-only";
  }
  if (!deployment.transactionsEnabled && enabled.length === 0)
    return "read-only";
  if (
    !deployment.transactionsEnabled ||
    enabled.length !== 1 ||
    registry.deployments.length !== 1
  )
    fail("signing requires one matching v2 testnet deployment");
  const r = enabled[0];
  if (
    r.network !== "testnet" ||
    r.chainId !== "testnet" ||
    r.recoveryVersion !== 2 ||
    deployment.config.disclosure_version !== "factory-v2" ||
    r.tokenId !== deployment.config.token_id ||
    deployment.vaultId !==
      `v-${deployment.config.campaign_id}.${r.factoryId}` ||
    deployment.config.strategy_id !==
      `s-${deployment.config.campaign_id}.${r.factoryId}` ||
    r.vaultCodeHash !== deployment.codeHashes[deployment.vaultId] ||
    r.strategyCodeHash !== deployment.codeHashes[deployment.config.strategy_id]
  )
    fail("runtime and recovery-enabled registry do not match");
  if (
    !review ||
    !acceptance ||
    acceptance.status !== "accepted" ||
    acceptance.runtimeSha256 !== releaseDigest(deployment) ||
    acceptance.registrySha256 !== releaseDigest(registry) ||
    acceptance.reviewSha256 !== releaseDigest(review)
  )
    fail("missing acceptance bound to these exact manifests and review");
  if (acceptanceChecks.some((name) => acceptance.checks?.[name] !== "passed"))
    fail("wallet or deployment acceptance is incomplete");
  if (
    !Array.isArray(acceptance.finalizedTransactions) ||
    acceptance.finalizedTransactions.length !== review.steps.length ||
    new Set(acceptance.finalizedTransactions).size !== review.steps.length ||
    acceptance.finalizedTransactions.some(
      (h) => !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(h),
    )
  )
    fail(
      "missing unique finalized transaction evidence for the reviewed steps",
    );
  return "signing-enabled";
}

import {
  canonical,
  ChainClient,
  inspectTransaction,
  requireThat,
  type Call,
  type Deployment,
  type Transaction,
} from "./chain";
import {
  CampaignRegistry,
  type RegistryCampaign,
  type RegistryDeployment,
} from "./campaigns";

export const REGISTRY_HISTORY = "yieldfund.registry-submissions.v1";
export interface RegistrySubmission {
  id: string;
  scope: string;
  account: string;
  call: Call;
  minHeight: number;
  createdAt: number;
  hash?: string;
  receipts: string[];
  state:
    | "awaiting-wallet"
    | "unknown"
    | "submitted"
    | "finalized"
    | "failed"
    | "attention"
    | "recovered";
  error?: string;
}
export const registryScope = (d: RegistryDeployment) =>
  `${d.chainId}:${d.factoryId}`;
export function registryHistory(
  storage: Pick<Storage, "getItem">,
): RegistrySubmission[] {
  const value = storage.getItem(REGISTRY_HISTORY);
  if (!value) return [];
  const rows: unknown = JSON.parse(value);
  requireThat(
    Array.isArray(rows) &&
      rows.every(
        (r) =>
          r &&
          typeof r.id === "string" &&
          typeof r.scope === "string" &&
          typeof r.account === "string" &&
          r.call &&
          Array.isArray(r.receipts) &&
          [
            "awaiting-wallet",
            "unknown",
            "submitted",
            "finalized",
            "failed",
            "attention",
            "recovered",
          ].includes(r.state),
      ),
    "Registry history is corrupt; preserve it before recovery",
  );
  return rows as RegistrySubmission[];
}
export function saveRegistrySubmission(
  storage: Pick<Storage, "getItem" | "setItem">,
  row: RegistrySubmission,
) {
  const rows = registryHistory(storage);
  const old = rows.find((r) => r.id === row.id);
  if (old)
    requireThat(
      old.scope === row.scope &&
        old.account === row.account &&
        canonical(old.call) === canonical(row.call),
      "Submission identity changed",
    );
  storage.setItem(
    REGISTRY_HISTORY,
    JSON.stringify([...rows.filter((r) => r.id !== row.id), row]),
  );
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("yieldfund:registry-history"));
}
export function assertRegistryAvailable(
  rows: RegistrySubmission[],
  d: RegistryDeployment,
  actor: string,
  recoveryCall?: Call,
) {
  requireThat(
    d.network === "testnet" && d.transactionsEnabled,
    "Registry is read only",
  );
  requireThat(
    !rows.some(
      (r) =>
        r.scope === registryScope(d) &&
        r.account === actor &&
        ["unknown", "submitted", "awaiting-wallet", "attention"].includes(
          r.state,
        ) &&
        !(
          r.state === "attention" &&
          d.recoveryVersion === 2 &&
          r.hash &&
          r.receipts.length > 0 &&
          recoveryCall?.methodName === "recover_campaign" &&
          recoveryCall.receiverId === d.factoryId &&
          ["create_campaign", "recover_campaign"].includes(r.call.methodName) &&
          r.call.receiverId === d.factoryId &&
          r.call.args.id === recoveryCall.args.id
        ),
    ),
    "Resolve the existing registry transaction before sending another",
  );
}
export function checkRegistryReceipt(
  tx: Transaction,
  row: RegistrySubmission,
  baseline: Deployment,
) {
  requireThat(row.hash, "Transaction hash required");
  return inspectTransaction(tx, row.hash, row.account, row.call, baseline);
}
export async function reconcileRegistrySubmission(
  row: RegistrySubmission,
  d: RegistryDeployment,
  baseline: Deployment,
): Promise<RegistrySubmission> {
  requireThat(row.scope === registryScope(d), "Registry scope changed");
  requireThat(row.hash, "Add the hash from wallet history");
  const client = new ChainClient({ ...baseline, rpcUrl: d.rpcUrl });
  const tx = await client.transaction(row.hash, row.account);
  const checked = checkRegistryReceipt(tx, row, baseline);
  const block = await client.rpc<{ header: { height: number } }>("block", {
    block_id: tx.transaction_outcome.block_hash,
  });
  requireThat(
    block.header.height >= row.minHeight,
    "Transaction predates this review",
  );
  if (checked.status === "pending") return { ...row, state: "submitted" };
  const creation = row.call.methodName === "create_campaign";
  const recovery = row.call.methodName === "recover_campaign";
  if (creation || recovery) {
    const registry = new CampaignRegistry(d);
    const snapshot = await registry.snapshot();
    const c = await registry.view<RegistryCampaign | null>(
      d.factoryId,
      "get_campaign",
      { id: row.call.args.id },
      snapshot.blockHash,
    );
    if (c) {
      requireThat(
        !creation ||
          (c.creator_id === row.account &&
            c.metadata_hash === row.call.args.metadata_hash &&
            c.beneficiary_id === row.call.args.beneficiary_id &&
            c.deposit_cap === row.call.args.deposit_cap),
        "Created campaign does not match review",
      );
      if (c.status === "ready") {
        await registry.resolveCampaign(c.id, baseline);
        return {
          ...row,
          state: checked.status === "finalized" ? "finalized" : "recovered",
          receipts: checked.receiptIds,
          error:
            checked.status === "finalized"
              ? undefined
              : "Original receipt failed; campaign setup has since completed.",
        };
      }
      return {
        ...row,
        state: "attention",
        receipts: checked.receiptIds,
        error:
          "Setup is incomplete. Resume the existing campaign; do not create it again.",
      };
    }
    requireThat(
      checked.status !== "finalized",
      "Created campaign does not match review",
    );
  }
  if (checked.status !== "finalized")
    return {
      ...row,
      state: checked.status,
      receipts: checked.receiptIds,
      error: "Inspect the failed receipt before continuing.",
    };
  return {
    ...row,
    state: "finalized",
    receipts: checked.receiptIds,
    error: undefined,
  };
}

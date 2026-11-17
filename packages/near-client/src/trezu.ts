/** Trezu custom-proposal manifests, not a replacement treasury or voting engine.
 * Schema: NEAR-DevHub/trezu 5694829ba441b9ef10ef34f0cfb3d09e0ad5f6ba.
 * Trezu files the proposal; the configured Sputnik DAO authorizes and executes it.
 */
import { account, raw } from "./chain.ts";

export const TREZU_REVISION = "5694829ba441b9ef10ef34f0cfb3d09e0ad5f6ba";
export interface TrezuManifest {
  version: 1;
  id: string;
  title: string;
  summary: string;
  binding: {
    receiver_id: string;
    method_name: string;
    deposit: string;
    gas: string;
  };
  fields: Array<{
    name: string;
    label: string;
    type: "text" | "uint" | "account";
    required: true;
    validation?: { min?: string; max?: string; pattern?: string };
  }>;
  args: Record<string, unknown>;
}
export function trezuLinks(network: string, daoId: string) {
  if (network !== "mainnet")
    throw new Error("Trezu's published wallet supports mainnet only");
  account(daoId);
  if (daoId.endsWith(".testnet"))
    throw new Error("Testnet DAO cannot open a mainnet treasury");
  const treasury = `https://trezu.app/${encodeURIComponent(daoId)}`;
  return {
    treasury,
    templates: `${treasury}/custom-templates`,
    createTemplate: `${treasury}/custom-templates/create`,
  };
}

/** Fixed receiver/method/deposit/gas: form values can never redirect the call. */
export function verificationTemplates(factoryId: string): TrezuManifest[] {
  account(factoryId);
  const id = {
    name: "campaign_id",
    label: "Campaign ID",
    type: "text" as const,
    required: true as const,
    validation: { pattern: "^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$" },
  };
  const hash = (name: string, label: string) => ({
    name,
    label,
    type: "text" as const,
    required: true as const,
    validation: { pattern: "^[a-f0-9]{64}$" },
  });
  return [
    {
      version: 1,
      id: "yieldfund-verify",
      title: "Verify YieldFund campaign",
      summary: "Verify {{campaign_id}}",
      binding: {
        receiver_id: factoryId,
        method_name: "verify_campaign",
        deposit: "1",
        gas: "30000000000000",
      },
      fields: [
        id,
        hash("metadata_hash", "Metadata hash"),
        hash("evidence_hash", "Evidence hash"),
        {
          name: "expires_at",
          label: "Expiry (Unix nanoseconds)",
          type: "uint",
          required: true,
          validation: { min: "1", max: "18446744073709551615" },
        },
      ],
      args: {
        id: "{{campaign_id}}",
        metadata_hash: "{{metadata_hash}}",
        evidence_hash: "{{evidence_hash}}",
        expires_at: "{{expires_at}}",
      },
    },
    {
      version: 1,
      id: "yieldfund-revoke",
      title: "Revoke YieldFund verification",
      summary: "Revoke verification for {{campaign_id}}",
      binding: {
        receiver_id: factoryId,
        method_name: "revoke_verification",
        deposit: "1",
        gas: "30000000000000",
      },
      fields: [id],
      args: { id: "{{campaign_id}}" },
    },
  ];
}

/** DAO must equal the immutable beneficiary and guardian before installing this template. */
export function yieldSettlementTemplate(
  vaultId: string,
  operationDeposit: string,
): TrezuManifest {
  account(vaultId);
  raw(operationDeposit);
  if (BigInt(operationDeposit) === 0n)
    throw new Error("Read the vault operation storage cost first");
  return {
    version: 1,
    id: "yieldfund-donate",
    title: "Settle YieldFund yield",
    summary: "Donate up to {{max_amount}} token base units",
    binding: {
      receiver_id: vaultId,
      method_name: "distribute_yield",
      deposit: operationDeposit,
      gas: "150000000000000",
    },
    fields: [
      {
        name: "max_amount",
        label: "Maximum (token base units)",
        type: "uint",
        required: true,
        validation: {
          min: "1",
          max: "340282366920938463463374607431768211455",
        },
      },
    ],
    args: { max_amount: "{{max_amount}}" },
  };
}

/** Treasury-controlled vault operations use the same Trezu proposal/vote pipeline. */
export function rheaOperationTemplates(
  vaultId: string,
  operationDeposit: string,
): TrezuManifest[] {
  const donation = yieldSettlementTemplate(vaultId, operationDeposit);
  return [
    donation,
    {
      ...donation,
      id: "yieldfund-allocate",
      title: "Supply YieldFund capital to Rhea",
      summary: "Supply {{amount}} token base units to Rhea",
      binding: {
        ...donation.binding,
        method_name: "allocate_idle",
        gas: "180000000000000",
      },
      fields: [
        {
          ...donation.fields[0],
          name: "amount",
          label: "Amount (token base units)",
        },
      ],
      args: { amount: "{{amount}}" },
    },
    {
      ...donation,
      id: "yieldfund-redeem",
      title: "Redeem YieldFund Rhea position",
      summary: "Start Rhea redemption",
      binding: {
        ...donation.binding,
        method_name: "redeem_strategy",
        gas: "260000000000000",
      },
      fields: [],
      args: {},
    },
    {
      ...donation,
      id: "yieldfund-continue",
      title: "Continue Rhea settlement",
      summary: "Continue operation {{operation_id}} at version {{version}}",
      binding: {
        ...donation.binding,
        method_name: "continue_rhea_redemption",
        deposit: "1",
        gas: "260000000000000",
      },
      fields: ["operation_id", "version"].map((name) => ({
        name,
        label: name === "version" ? "Current version" : "Operation ID",
        type: "uint" as const,
        required: true as const,
        validation: { min: "1", max: "18446744073709551615" },
      })),
      args: { operation_id: "{{operation_id}}", version: "{{version}}" },
    },
  ];
}

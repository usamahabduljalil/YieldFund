import { useCallback, useEffect, useState } from "react";
import {
  CampaignRegistry,
  verificationAction,
  verificationProposal,
  type RegistryCampaign,
  type RegistryDeployment,
  type RegistrySnapshot,
  type VerificationProposal,
} from "../../../packages/near-client/src/campaigns";
import type { Deployment } from "../../../packages/near-client/src/chain";
import { RegistryAction } from "./registry-action";

export function VerificationPanel({
  deployment,
  baseline,
  campaign,
  onDone,
}: {
  deployment: RegistryDeployment;
  baseline: Deployment;
  campaign: RegistryCampaign;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false),
    [evidence, setEvidence] = useState(""),
    [expiry, setExpiry] = useState(""),
    [revoke, setRevoke] = useState(false);
  const [proposals, setProposals] = useState<VerificationProposal[]>([]),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (!open) return;
    setError("");
    void (async () => {
      const registry = new CampaignRegistry(deployment),
        s = await registry.snapshot();
      const count = await registry.view<number>(
        deployment.verifierId,
        "get_last_proposal_id",
        {},
        s.blockHash,
      );
      if (!Number.isSafeInteger(count) || count < 0)
        throw Error("Invalid proposal count");
      const rows = await registry.view<VerificationProposal[]>(
        deployment.verifierId,
        "get_proposals",
        { from_index: Math.max(0, count - 50), limit: 50 },
        s.blockHash,
      );
      if (active)
        setProposals(
          rows.filter(
            (p) => p.kind?.FunctionCall?.receiver_id === deployment.factoryId,
          ),
        );
    })().catch((e) => {
      if (active) setError(String(e));
    });
    return () => {
      active = false;
    };
  }, [open, deployment, refresh]);
  const build = useCallback(
    async (s: RegistrySnapshot, actor: string, r: CampaignRegistry) => {
      const c = await r.view<RegistryCampaign>(
        deployment.factoryId,
        "get_campaign",
        { id: campaign.id },
        s.blockHash,
      );
      const milliseconds = Date.parse(expiry);
      if (!revoke && !Number.isSafeInteger(milliseconds))
        throw Error("Enter an expiry date and time");
      return verificationProposal(
        deployment,
        s.policy,
        actor,
        c,
        revoke
          ? { kind: "revoke" }
          : {
              kind: "verify",
              evidenceHash: evidence.trim(),
              expiresAt: String(BigInt(milliseconds) * 1_000_000n),
            },
        s.timestamp,
      );
    },
    [deployment, campaign.id, evidence, expiry, revoke],
  );
  function done() {
    setRefresh((n) => n + 1);
    onDone();
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>DAO verification</summary>
      {open && (
        <>
          <p>Only an approved DAO call can change this badge.</p>
          <p className="chain-hash">DAO: {deployment.verifierId}</p>
          <div className="campaign-form">
            <label>
              Action
              <select
                value={revoke ? "revoke" : "verify"}
                onChange={(e) => setRevoke(e.target.value === "revoke")}
              >
                <option value="verify">Verify campaign</option>
                <option value="revoke">Revoke verification</option>
              </select>
            </label>
            {!revoke && (
              <>
                <label>
                  Evidence SHA-256
                  <input
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    maxLength={64}
                  />
                </label>
                <label>
                  Expires at (local time)
                  <input
                    type="datetime-local"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </label>
              </>
            )}
            <RegistryAction
              deployment={deployment}
              baseline={baseline}
              build={build}
              label="Review verification proposal"
              onDone={done}
            />
          </div>
          {error && <p role="alert">{error}</p>}
          <h3>Verification proposals</h3>
          {!proposals.length && (
            <p>No matching proposals among the latest 50.</p>
          )}
          {proposals.map((p) => (
            <Vote
              key={p.id}
              deployment={deployment}
              baseline={baseline}
              campaign={campaign}
              proposal={p}
              onDone={done}
            />
          ))}
        </>
      )}
    </details>
  );
}
function Vote({
  deployment,
  baseline,
  campaign,
  proposal,
  onDone,
}: {
  deployment: RegistryDeployment;
  baseline: Deployment;
  campaign: RegistryCampaign;
  proposal: VerificationProposal;
  onDone: () => void;
}) {
  const [action, setAction] = useState<
    "VoteApprove" | "VoteReject" | "Finalize"
  >(proposal.status === "Failed" ? "Finalize" : "VoteApprove");
  const build = useCallback(
    async (s: RegistrySnapshot, actor: string, r: CampaignRegistry) => {
      const p = await r.view<VerificationProposal>(
        deployment.verifierId,
        "get_proposal",
        { id: proposal.id },
        s.blockHash,
      );
      const c = await r.view<RegistryCampaign>(
        deployment.factoryId,
        "get_campaign",
        { id: campaign.id },
        s.blockHash,
      );
      return verificationAction(
        deployment,
        s.policy,
        actor,
        c,
        p,
        action,
        s.timestamp,
      );
    },
    [deployment, proposal.id, campaign.id, action],
  );
  // Show only proposals for this campaign; malformed kinds are never actionable.
  let id: unknown;
  try {
    id = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(proposal.kind.FunctionCall.actions[0].args), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ).id;
  } catch {
    return null;
  }
  if (id !== campaign.id) return null;
  return (
    <div className="chain-submission">
      <strong>
        #{proposal.id} · {proposal.status}
      </strong>
      <p>{proposal.description}</p>
      <p>{Object.keys(proposal.votes).length} votes recorded</p>
      {["InProgress", "Failed"].includes(proposal.status) && (
        <>
          <label>
            Decision
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as typeof action)}
            >
              {proposal.status === "Failed" ? (
                <option value="Finalize">Retry failed execution</option>
              ) : (
                <>
                  <option value="VoteApprove">Approve</option>
                  <option value="VoteReject">Reject</option>
                </>
              )}
            </select>
          </label>
          <RegistryAction
            deployment={deployment}
            baseline={baseline}
            build={build}
            label="Review DAO vote"
            onDone={onDone}
          />
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Plus, ArrowsClockwise } from "@phosphor-icons/react";
import { parseAmount } from "@yieldfund/domain";
import { Badge, Empty, Notice } from "./components";
import {
  CampaignRegistry,
  campaignMetadata,
  campaignVerified,
  creationCall,
  parseRegistry,
  type RegistryDeployment,
  type RegistrySnapshot,
} from "../../../packages/near-client/src/campaigns";
import type { Deployment } from "../../../packages/near-client/src/chain";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Campaigns unavailable.";
const displayAmount = (value: string, decimals = 24) => {
  const n = BigInt(value),
    scale = 10n ** BigInt(decimals);
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${n / scale}${fraction ? `.${fraction}` : ""}`;
};
function saveJson(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CampaignDirectory({ current }: { current?: Deployment }) {
  const [network, setNetwork] = useState<"testnet" | "mainnet">("testnet");
  const [deployments, setDeployments] = useState<RegistryDeployment[] | null>(
    null,
  );
  const [result, setResult] = useState<{
    deployment: RegistryDeployment;
    offset: string;
    snapshot: RegistrySnapshot;
  } | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState("0");
  const create = useLocation().pathname.endsWith("/new");
  useEffect(() => {
    let active = true;
    fetch("/registry.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Registry configuration unavailable.");
        const body = await r.json();
        if (!Array.isArray(body.deployments))
          throw Error("Invalid registry configuration.");
        const list: RegistryDeployment[] = body.deployments.map(parseRegistry);
        if (new Set(list.map((d) => d.network)).size !== list.length)
          throw Error("Duplicate registry network.");
        if (active) setDeployments(list);
      })
      .catch((e) => {
        if (active) {
          setError(message(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const deployment = deployments?.find((d) => d.network === network);
  const snapshot =
    result?.deployment === deployment && result?.offset === offset
      ? result.snapshot
      : null;
  useEffect(() => {
    let active = true;
    setResult(null);
    if (!deployments) return;
    setError("");
    if (!deployment) {
      setLoading(false);
      return;
    }
    setLoading(true);
    new CampaignRegistry(deployment)
      .snapshot(offset)
      .then((s) => {
        if (active) setResult({ deployment, offset, snapshot: s });
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deployment, deployments, offset, refresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMMUNITY CAPITAL</span>
          <h1>{create ? "Create a campaign" : "Find your community."}</h1>
        </div>
        {create ? (
          <Link className="button secondary" to="/app/campaigns">
            All campaigns
          </Link>
        ) : (
          <Link className="button" to="/app/campaigns/new">
            <Plus size={18} />
            Create campaign
          </Link>
        )}
      </div>
      <div className="campaign-toolbar">
        <label>
          Browse network
          <select
            value={network}
            onChange={(e) => {
              setNetwork(e.target.value as typeof network);
              setOffset("0");
            }}
          >
            <option value="testnet">NEAR testnet</option>
            <option value="mainnet">NEAR mainnet</option>
          </select>
        </label>
        {deployment && (
          <button
            className="button secondary small"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            <ArrowsClockwise size={16} />
            {loading ? "Checking…" : "Refresh"}
          </button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {create ? (
        <CampaignDraft
          key={`${network}:${deployment?.factoryId ?? "draft"}`}
          deployment={deployment}
          snapshot={snapshot}
          current={network === "testnet" ? current : undefined}
          network={network}
        />
      ) : (
        <>
          <div className="campaign-cards">
            {network === "testnet" && (
              <section className="panel campaign-directory-card">
                <div className="campaign-card-top">
                  <Badge>Testnet</Badge>
                  <Badge>Unverified</Badge>
                </div>
                <h2>The Commons</h2>
                <p>Open-source maintenance.</p>
                <dl className="chain-data">
                  <div>
                    <dt>Strategy</dt>
                    <dd>Funded simulator</dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd>tUSD</dd>
                  </div>
                </dl>
                <Link className="button secondary" to="/app/campaigns/commons">
                  Open campaign
                  <ArrowUpRight size={17} />
                </Link>
              </section>
            )}
            {snapshot?.campaigns.map((c) => (
              <section className="panel campaign-directory-card" key={c.id}>
                <div className="campaign-card-top">
                  <Badge>{network}</Badge>
                  <Badge
                    tone={
                      campaignVerified(c, deployment!, snapshot.timestamp)
                        ? "success"
                        : "neutral"
                    }
                  >
                    {campaignVerified(c, deployment!, snapshot.timestamp)
                      ? "DAO verified"
                      : "Unverified"}
                  </Badge>
                </div>
                <h2>{c.name}</h2>
                <dl className="chain-data">
                  <div>
                    <dt>Status</dt>
                    <dd>{c.status}</dd>
                  </div>
                  <div>
                    <dt>Strategy</dt>
                    <dd>Funded simulator</dd>
                  </div>
                  <div>
                    <dt>Token</dt>
                    <dd>{c.token_id}</dd>
                  </div>
                  <div>
                    <dt>Vault</dt>
                    <dd>{c.vault_id}</dd>
                  </div>
                  <div>
                    <dt>Treasury</dt>
                    <dd>{c.beneficiary_id}</dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
          {loading && <p role="status">Checking campaign registry…</p>}
          {deployments && !deployment && (
            <Notice>
              {network === "mainnet"
                ? "Mainnet campaigns are not deployed yet."
                : "Permissionless creation is awaiting factory deployment."}
            </Notice>
          )}
          {snapshot && (
            <div className="campaign-toolbar">
              <button
                className="button secondary small"
                disabled={offset === "0"}
                onClick={() =>
                  setOffset(
                    String(BigInt(offset) > 50n ? BigInt(offset) - 50n : 0n),
                  )
                }
              >
                Previous
              </button>
              <span>
                {snapshot.count} campaigns · block {snapshot.height}
              </span>
              <button
                className="button secondary small"
                disabled={BigInt(offset) + 50n >= BigInt(snapshot.count)}
                onClick={() => setOffset(String(BigInt(offset) + 50n))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
function CampaignDraft({
  deployment,
  snapshot,
  current,
  network,
}: {
  deployment?: RegistryDeployment;
  snapshot: RegistrySnapshot | null;
  current?: Deployment;
  network: "testnet" | "mainnet";
}) {
  const [name, setName] = useState(""),
    [id, setId] = useState(""),
    [treasury, setTreasury] = useState(""),
    [cap, setCap] = useState("");
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const token = deployment?.tokenId ?? current?.config.token_id;
  const decimals = deployment?.tokenDecimals ?? current?.config.token_decimals;
  const [review, setReview] = useState<{
    metadata: { content: string; hash: string };
    call: ReturnType<typeof creationCall> | null;
    input: {
      id: string;
      name: string;
      beneficiaryId: string;
      depositCap: string;
    };
  } | null>(null);
  function invalidate() {
    generation.current++;
    setReview(null);
    setSaved(false);
    setError("");
    setBusy(false);
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setSaved(false);
    setReview(null);
    try {
      if (!token || decimals === undefined)
        throw Error("A supported token deployment is required.");
      const input = {
        id: id.trim(),
        name: name.trim(),
        beneficiaryId: treasury.trim(),
        depositCap: parseAmount(cap, decimals).toString(),
      };
      if (!/^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(input.id))
        throw Error("Use 1–24 lowercase letters, numbers or hyphens.");
      if (!input.name || new TextEncoder().encode(input.name).length > 80)
        throw Error("Use a shorter campaign name.");
      if (
        !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(input.beneficiaryId) ||
        input.beneficiaryId.length < 2 ||
        input.beneficiaryId.length > 64
      )
        throw Error("Enter a valid treasury account.");
      if (BigInt(input.depositCap) <= 0n)
        throw Error("Enter a positive deposit cap.");
      if (input.beneficiaryId === token)
        throw Error("The treasury must differ from the token contract.");
      const metadata = await campaignMetadata(input, token);
      // Read again before fixing any funding amount or factory destination in a review.
      const registry = deployment ? new CampaignRegistry(deployment) : null;
      const fresh = registry ? await registry.snapshot() : null;
      const existing =
        registry && fresh
          ? await registry.view(
              deployment!.factoryId,
              "get_campaign",
              { id: input.id },
              fresh.blockHash,
            )
          : null;
      if (existing) throw Error("This campaign ID already exists.");
      const call =
        deployment && fresh
          ? creationCall(deployment, fresh.cost, {
              ...input,
              metadataHash: metadata.hash,
            })
          : null;
      if (generation.current === request) setReview({ input, metadata, call });
    } catch (e) {
      if (generation.current === request) setError(message(e));
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  if (!token)
    return (
      <Empty
        title={
          network === "mainnet"
            ? "Mainnet creation is not available yet."
            : "Campaign creation requires a configured token."
        }
      >
        <Link className="button secondary" to="/app/campaigns">
          Browse campaigns
        </Link>
      </Empty>
    );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Campaign details</h2>
        <Badge>{deployment ? "Unsigned review" : "Draft only"}</Badge>
      </div>
      <div className="chain-panel-body">
        <form className="campaign-form" onSubmit={(e) => void prepare(e)}>
          <label>
            Name
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                invalidate();
              }}
              placeholder="Your community"
            />
          </label>
          <label>
            Campaign ID
            <input
              required
              maxLength={24}
              value={id}
              onChange={(e) => {
                setId(e.target.value);
                invalidate();
              }}
              placeholder="your-community"
            />
          </label>
          <label>
            Treasury DAO
            <input
              required
              maxLength={64}
              value={treasury}
              onChange={(e) => {
                setTreasury(e.target.value);
                invalidate();
              }}
              placeholder="community.sputnik-dao.testnet"
            />
          </label>
          <label>
            Deposit cap
            <input
              required
              inputMode="decimal"
              value={cap}
              onChange={(e) => {
                setCap(e.target.value);
                invalidate();
              }}
              placeholder="10000"
            />
          </label>
          <dl className="chain-data">
            <div>
              <dt>Token</dt>
              <dd>{token}</dd>
            </div>
            <div>
              <dt>Strategy</dt>
              <dd>Funded simulator</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>DAO approval required</dd>
            </div>
            {snapshot && (
              <div>
                <dt>Creation funding</dt>
                <dd>{displayAmount(snapshot.cost)} NEAR + gas</dd>
              </div>
            )}
          </dl>
          <Notice>
            {deployment
              ? "This prepares an unsigned call. It does not create the campaign."
              : "Save your draft now. Creation awaits factory deployment."}
          </Notice>
          <button className="button" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Review campaign"}
          </button>
        </form>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {review && (
          <div className="campaign-review">
            <h3>Review {review.input.name}</h3>
            <dl className="chain-data">
              <div>
                <dt>Campaign ID</dt>
                <dd>{review.input.id}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{network}</dd>
              </div>
              <div>
                <dt>Deposit cap</dt>
                <dd>{displayAmount(review.input.depositCap, decimals!)}</dd>
              </div>
              <div>
                <dt>Fixed treasury</dt>
                <dd>{review.input.beneficiaryId}</dd>
              </div>
              <div>
                <dt>Metadata SHA-256</dt>
                <dd>{review.metadata.hash}</dd>
              </div>
              {review.call && (
                <div>
                  <dt>Attached funding</dt>
                  <dd>{displayAmount(review.call.deposit)} NEAR + gas</dd>
                </div>
              )}
            </dl>
            <p>Unverified at creation. Metadata and treasury are fixed.</p>
            <button
              className="button secondary"
              onClick={() => {
                saveJson(
                  `yieldfund-${review.input.id}-${review.call ? "unsigned" : "draft"}.json`,
                  {
                    schemaVersion: 1,
                    network,
                    tokenId: token,
                    tokenDecimals: decimals,
                    metadata: JSON.parse(review.metadata.content),
                    metadataHash: review.metadata.hash,
                    ...(review.call
                      ? { factoryId: deployment!.factoryId, call: review.call }
                      : { draft: true }),
                    signed: false,
                  },
                );
                setSaved(true);
              }}
            >
              {review.call ? "Download unsigned call" : "Save campaign draft"}
            </button>
            {saved && <p role="status">Saved. No transaction sent.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  canonical,
  ChainClient,
  type Call,
  type Deployment,
  type Snapshot,
} from "../../../packages/near-client/src/chain";
import {
  CampaignRegistry,
  type RegistryDeployment,
  type RegistrySnapshot,
} from "../../../packages/near-client/src/campaigns";
import {
  assertRegistryAvailable,
  registryHistory,
  registryScope,
  saveRegistrySubmission,
  reconcileRegistrySubmission,
  type RegistrySubmission,
} from "../../../packages/near-client/src/registry-actions";
import { useWallet } from "./wallet";
import { walletFailure, type WalletSessionToken } from "./wallet-session";
import { Notice } from "./components";

export type RegistryBuilder = (
  snapshot: RegistrySnapshot,
  account: string,
  registry: CampaignRegistry,
) => Promise<Call>;
export function RegistryAction({
  deployment,
  baseline,
  build,
  label,
  onDone,
}: {
  deployment: RegistryDeployment;
  baseline: Deployment;
  build: RegistryBuilder;
  label: string;
  onDone?: () => void;
}) {
  const wallet = useWallet();
  const [review, setReview] = useState<{
    call: Call;
    session: WalletSessionToken;
    builder: RegistryBuilder;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const sending = useRef(false);
  useEffect(() => {
    generation.current++;
    setReview(null);
    if (!sending.current) setBusy(false);
    return () => {
      generation.current++;
    };
  }, [build, deployment, wallet.account]);
  async function prepare() {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setReview(null);
    try {
      const session = wallet.session.capture();
      assertRegistryAvailable(
        registryHistory(localStorage),
        deployment,
        session.account,
      );
      const registry = new CampaignRegistry(deployment),
        snapshot = await registry.snapshot();
      const call = await build(snapshot, session.account, registry);
      await new ChainClient({
        ...baseline,
        rpcUrl: deployment.rpcUrl,
      }).checkFunding(
        {
          accountId: session.account,
          blockHash: snapshot.blockHash,
        } as Snapshot,
        call,
      );
      wallet.session.assert(session);
      if (request === generation.current)
        setReview({ call, session, builder: build });
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function sign() {
    if (!review || review.builder !== build || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const request = generation.current;
    let row: RegistrySubmission | undefined;
    try {
      wallet.session.assert(review.session);
      assertRegistryAvailable(
        registryHistory(localStorage),
        deployment,
        review.session.account,
      );
      const registry = new CampaignRegistry(deployment),
        snapshot = await registry.snapshot();
      const call = await build(snapshot, review.session.account, registry);
      if (
        request !== generation.current ||
        canonical(call) !== canonical(review.call)
      )
        throw Error("Review changed. Prepare it again.");
      await new ChainClient({
        ...baseline,
        rpcUrl: deployment.rpcUrl,
      }).checkFunding(
        {
          accountId: review.session.account,
          blockHash: snapshot.blockHash,
        } as Snapshot,
        call,
      );
      wallet.session.assert(review.session);
      if (request !== generation.current)
        throw Error("Review changed. Prepare it again.");
      row = {
        id: crypto.randomUUID(),
        scope: registryScope(deployment),
        account: review.session.account,
        call,
        minHeight: snapshot.height,
        createdAt: Date.now(),
        state: "awaiting-wallet",
        receipts: [],
      };
      saveRegistrySubmission(localStorage, row);
      const result = (await wallet.send(call, review.session)) as
        { transaction?: { hash?: string } } | undefined;
      row = {
        ...row,
        hash: result?.transaction?.hash,
        state: result?.transaction?.hash ? "submitted" : "unknown",
      };
      saveRegistrySubmission(localStorage, row);
      if (row.hash) {
        row = await reconcileRegistrySubmission(row, deployment, baseline);
        saveRegistrySubmission(localStorage, row);
      }
      setReview(null);
      onDone?.();
    } catch (e) {
      if (row) {
        const failure = walletFailure(e);
        saveRegistrySubmission(localStorage, {
          ...row,
          state: row.hash ? "submitted" : failure.state,
          error: e instanceof Error ? e.message : "Outcome unknown",
        });
      }
      setError(e instanceof Error ? e.message : "Submission needs review");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="campaign-review">
      <button
        className="button"
        disabled={busy || !wallet.account || !deployment.transactionsEnabled}
        onClick={() => void prepare()}
      >
        {busy ? "Checking…" : label}
      </button>
      {!deployment.transactionsEnabled ? (
        <p>Signing is disabled in this demo.</p>
      ) : (
        !wallet.account && <p>Connect your testnet wallet to continue.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {review && review.builder === build && (
        <>
          <h3>Review transaction</h3>
          <dl className="chain-data">
            <div>
              <dt>Account</dt>
              <dd>{review.session.account}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>{review.call.receiverId}</dd>
            </div>
            <div>
              <dt>Attached NEAR</dt>
              <dd>{review.call.deposit} yoctoNEAR</dd>
            </div>
          </dl>
          <pre className="chain-json">
            {JSON.stringify(review.call, null, 2)}
          </pre>
          <Notice>
            Testnet only. Creation fixes the treasury and metadata. Incomplete
            creation needs reconciliation; never send it again blindly.
          </Notice>
          <button
            className="button"
            disabled={busy}
            onClick={() => void sign()}
          >
            Confirm in wallet
          </button>
        </>
      )}
    </div>
  );
}
export function RegistryHistory({
  deployment,
  baseline,
  refresh = 0,
}: {
  deployment: RegistryDeployment;
  baseline: Deployment;
  refresh?: number;
}) {
  const [rows, setRows] = useState<RegistrySubmission[]>([]),
    [error, setError] = useState("");
  const [hashes, setHashes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        setRows(
          registryHistory(localStorage).filter(
            (r) => r.scope === registryScope(deployment),
          ),
        );
        setError("");
      } catch (e) {
        setError(String(e));
      }
    };
    read();
    window.addEventListener("yieldfund:registry-history", read);
    return () => window.removeEventListener("yieldfund:registry-history", read);
  }, [deployment, refresh]);
  async function check(row: RegistrySubmission) {
    setBusy(row.id);
    setError("");
    try {
      const hash = row.hash || hashes[row.id];
      if (!hash || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(hash))
        throw Error("Enter the exact hash from wallet history");
      if (
        registryHistory(localStorage).some(
          (r) => r.id !== row.id && r.scope === row.scope && r.hash === hash,
        )
      )
        throw Error("Hash already assigned to another submission");
      const updated = await reconcileRegistrySubmission(
        { ...row, hash },
        deployment,
        baseline,
      );
      saveRegistrySubmission(localStorage, updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt check failed");
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Campaign transactions</h2>
      </div>
      <div className="chain-panel-body">
        {error && <p role="alert">{error}</p>}
        {!rows.length && <p>No campaign transactions on this browser.</p>}
        {rows.map((row) => (
          <div className="chain-submission" key={row.id}>
            <strong>
              {row.call.methodName} · {row.state}
            </strong>
            <small>{row.account}</small>
            {row.hash && <code className="chain-hash">{row.hash}</code>}
            {row.error && <p>{row.error}</p>}
            {!row.hash && row.state !== "failed" && (
              <label>
                Transaction hash
                <input
                  value={hashes[row.id] ?? ""}
                  onChange={(e) =>
                    setHashes({ ...hashes, [row.id]: e.target.value.trim() })
                  }
                />
              </label>
            )}
            {row.state !== "finalized" && row.state !== "failed" && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => void check(row)}
              >
                Check receipts
              </button>
            )}
            {!!row.receipts.length && (
              <details>
                <summary>{row.receipts.length} checked receipts</summary>
                <pre className="chain-json">{row.receipts.join("\n")}</pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

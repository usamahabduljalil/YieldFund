import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChainClient,
  canonical,
  inspectTransaction,
  parseDeployment,
  type Call,
  type Deployment,
  type ReceiptCheck,
  type RuntimeConfig,
  type Snapshot,
} from "../../../packages/near-client/src/chain";
import {
  prepareCall,
  restoreSubmissions,
  persistSubmissions,
  scope,
  type Intent,
  type Submission,
} from "../../../packages/near-client/src/actions";
import { useWallet } from "./wallet";
import { walletFailure, type WalletSessionToken } from "./wallet-session";
import { receiptChecks } from "./receipt-tracking";
export async function loadRuntime(): Promise<RuntimeConfig> {
  const url = new URL(
    import.meta.env.VITE_DEPLOYMENT_URL || "/deployment.json",
    location.origin,
  );
  if (url.origin !== location.origin)
    throw new Error("Deployment configuration must be served by this app.");
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error("Deployment configuration unavailable.");
  return parseDeployment(await r.json());
}
export interface Review {
  intent: Intent;
  call: Call;
  account: string;
  session: WalletSessionToken;
  height: number;
}
interface State {
  deployment: Deployment;
  client: ChainClient;
  snapshot: Snapshot | null;
  error: string;
  loading: boolean;
  submissions: Submission[];
  refresh: () => Promise<void>;
  prepare: (intent: Intent) => Promise<Review>;
  submit: (review: Review) => Promise<void>;
  track: (id: string, hash?: string) => Promise<void>;
  receipt: (hash: string, actor: string, call: Call) => Promise<ReceiptCheck>;
}
const Context = createContext<State | null>(null);
export const useChain = () => {
  const s = useContext(Context);
  if (!s) throw new Error("Chain context missing");
  return s;
};
export function ChainProvider({
  deployment,
  children,
}: {
  deployment: Deployment;
  children: ReactNode;
}) {
  const wallet = useWallet();
  const [client] = useState(() => new ChainClient(deployment));
  const [checkReceipt] = useState(receiptChecks);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState<Submission[]>(() =>
    restoreSubmissions(localStorage, deployment),
  );
  const records = useRef(submissions),
    sending = useRef(false);
  const currentRefresh = useRef<() => Promise<void>>(async () => {});
  const persist = useCallback(
    (next: Submission[]) => {
      persistSubmissions(localStorage, deployment, next);
      records.current = next;
      setSubmissions(next);
    },
    [deployment],
  );
  const update = useCallback(
    (id: string, patch: Partial<Submission>) =>
      persist(
        records.current.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      ),
    [persist],
  );
  // Receipt handlers can outlive the account that created them. Always dispatch
  // their refresh through the current committed account's reader.
  const refresh = useCallback(() => currentRefresh.current(), []);
  useLayoutEffect(() => {
    let active = true;
    let pending = false;
    const read = async () => {
      if (!active || pending) return;
      pending = true;
      setLoading(true);
      try {
        const s = await client.snapshot(wallet.account);
        if (active) {
          setSnapshot(s);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Could not read contracts");
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    currentRefresh.current = read;
    setSnapshot(null);
    setError("");
    void read();
    const timer = setInterval(() => {
      if (!sending.current) void read();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, wallet.account]);
  const receipt = useCallback(
    async (hash: string, actor: string, call: Call) =>
      inspectTransaction(
        await client.transaction(hash, actor),
        hash,
        actor,
        call,
        deployment,
      ),
    [client, deployment],
  );
  const track = useCallback(
    (id: string, manualHash?: string) =>
      checkReceipt(id, async () => {
        const row = records.current.find((r) => r.id === id);
        if (!row) return;
        const hash = manualHash || row.hash;
        if (!hash)
          throw new Error("Enter the transaction hash from your wallet.");
        try {
          if (records.current.some((r) => r.id !== id && r.hash === hash))
            throw new Error(
              "Transaction already belongs to another submission.",
            );
          const tx = await client.transaction(hash, row.accountId);
          const { header } = await client.rpc<{ header: { height: number } }>(
            "block",
            { block_id: tx.transaction_outcome.block_hash },
          );
          if (header.height <= row.minHeight)
            throw new Error("Transaction predates this wallet review.");
          const result = inspectTransaction(
            tx,
            hash,
            row.accountId,
            row.call,
            deployment,
          );
          update(id, {
            hash,
            state: result.status === "pending" ? "submitted" : result.status,
            operationIds: result.operations,
            receiptIds: result.receiptIds,
            summary: result.summary,
            paymentConfirmed: result.paymentConfirmed,
            error:
              result.status === "attention"
                ? "A nested receipt failed. Inspect the contract operation."
                : undefined,
          });
          await refresh();
        } catch (e) {
          if (!manualHash)
            update(id, {
              state: "unknown",
              error: e instanceof Error ? e.message : "Receipt unavailable",
            });
          throw e;
        }
      }),
    [client, deployment, update, refresh, checkReceipt],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      for (const r of records.current)
        if (r.hash && ["submitted", "unknown"].includes(r.state))
          void track(r.id).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [track]);
  useEffect(() => {
    const hashes = new URLSearchParams(location.search)
      .get("transactionHashes")
      ?.split(",");
    const unknown = records.current.filter(
      (r) => !r.hash && ["unknown", "awaiting-wallet"].includes(r.state),
    );
    if (hashes?.length === 1 && unknown.length === 1)
      void track(unknown[0].id, hashes[0]).catch(() => {});
  }, [track]);
  async function prepare(intent: Intent): Promise<Review> {
    const session = wallet.session.capture();
    if (!deployment.transactionsEnabled || deployment.network !== "testnet")
      throw new Error("This deployment is read-only.");
    if (
      records.current.some(
        (r) =>
          r.accountId === session.account &&
          ["awaiting-wallet", "submitted", "unknown"].includes(r.state),
      )
    )
      throw new Error(
        "Resolve the pending wallet submission in Activity first.",
      );
    const s = await client.snapshot(session.account);
    wallet.session.assert(session);
    setSnapshot(s);
    setError("");
    if (
      intent.kind === "advance" ||
      intent.kind === "cancel" ||
      intent.kind === "recover"
    ) {
      const o = await client.operation(intent.operation.id);
      if (!o) throw new Error("Operation not found");
      intent = { ...intent, operation: o };
    }
    if (intent.kind === "vote")
      intent = {
        ...intent,
        proposal: await client.proposal(intent.proposal.id),
      };
    const call = prepareCall(deployment, s, session.account, intent);
    await client.checkFunding(s, call);
    wallet.session.assert(session);
    return {
      intent,
      call,
      account: session.account,
      session,
      height: s.height,
    };
  }
  async function submit(review: Review) {
    if (sending.current) throw new Error("Submission already in progress");
    sending.current = true;
    let row: Submission | undefined;
    try {
      wallet.session.assert(review.session);
      const fresh = await prepare(review.intent);
      wallet.session.assert(review.session);
      if (canonical(fresh.call) !== canonical(review.call))
        throw new Error("Transaction changed. Review again.");
      row = {
        id: crypto.randomUUID(),
        scope: scope(deployment),
        accountId: review.account,
        call: review.call,
        createdAt: Date.now(),
        minHeight: fresh.height,
        state: "awaiting-wallet",
        operationIds: [],
        receiptIds: [],
      };
      persist([...records.current, row]);
      const result = await wallet.send(review.call, review.session);
      const hash = (result as { transaction?: { hash?: string } } | undefined)
        ?.transaction?.hash;
      if (!hash) {
        update(row.id, {
          state: "unknown",
          error: "Wallet returned no transaction hash. Check wallet history.",
        });
        return;
      }
      update(row.id, { hash, state: "submitted" });
      await track(row.id);
    } catch (e) {
      if (row) update(row.id, walletFailure(e));
      throw e;
    } finally {
      sending.current = false;
    }
  }
  return (
    <Context.Provider
      value={{
        deployment,
        client,
        snapshot: snapshot?.accountId === wallet.account ? snapshot : null,
        error,
        loading,
        submissions,
        refresh,
        prepare,
        submit,
        track,
        receipt,
      }}
    >
      {children}
    </Context.Provider>
  );
}

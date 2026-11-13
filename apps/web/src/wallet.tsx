import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Wallet, SignOut } from "@phosphor-icons/react";
import type { NearConnector } from "@hot-labs/near-connect";
import type { Call } from "../../../packages/near-client/src/chain";
import { currentRpcUrl } from "../../../packages/near-client/src/read-transport";
import {
  WalletSession,
  sendWithSession,
  type WalletSessionToken,
} from "./wallet-session";
type WalletState = {
  account: string;
  busy: boolean;
  error: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  session: WalletSession;
  send: (call: Call, token: WalletSessionToken) => Promise<unknown>;
  clearError: () => void;
};
const Context = createContext<WalletState | null>(null);
export const useWallet = () => {
  const c = useContext(Context);
  if (!c) throw new Error("Wallet provider missing");
  return c;
};
export function WalletProvider({
  children,
  rpcUrl,
}: {
  children: ReactNode;
  rpcUrl?: string;
}) {
  const [account, setAccount] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const pending = useRef<Promise<NearConnector> | null>(null);
  const [session] = useState(() => new WalletSession());
  const connectionAttempt = useRef(0);
  const selectAccount = useCallback(
    (accountId: string) => {
      session.select(accountId);
      setAccount(accountId);
    },
    [session],
  );
  useEffect(() => () => session.select(""), [session]);
  async function getConnector() {
    if (!pending.current)
      pending.current = import("@hot-labs/near-connect")
        .then(({ NearConnector }) => {
          const c = new NearConnector({
            network: "testnet",
            autoConnect: false,
            features: {
              testnet: true,
              signInWithoutAddKey: true,
              signAndSendTransaction: true,
            },
            footerBranding: null,
            ...(rpcUrl
              ? { providers: { testnet: [currentRpcUrl(rpcUrl)] } }
              : {}),
          });
          setConnector(c);
          return c;
        })
        .catch((e) => {
          pending.current = null;
          throw e;
        });
    return pending.current;
  }
  useEffect(() => {
    if (!connector) return;
    const onIn = (e: { accounts: { accountId: string }[] }) =>
      selectAccount(e.accounts[0]?.accountId ?? "");
    const onOut = () => selectAccount("");
    connector.on("wallet:signIn", onIn);
    connector.on("wallet:signOut", onOut);
    return () => {
      connector.off("wallet:signIn", onIn);
      connector.off("wallet:signOut", onOut);
    };
  }, [connector, selectAccount]);
  async function connect() {
    const attempt = ++connectionAttempt.current;
    selectAccount("");
    setBusy(true);
    setError("");
    try {
      const c = await getConnector();
      await c.connect();
      const w = await c.wallet();
      const accounts = await w.getAccounts({ network: "testnet" });
      if (attempt === connectionAttempt.current)
        selectAccount(accounts[0]?.accountId ?? "");
    } catch (e) {
      if (attempt === connectionAttempt.current)
        setError(
          e instanceof Error ? e.message : "Wallet connection cancelled.",
        );
    } finally {
      if (attempt === connectionAttempt.current) setBusy(false);
    }
  }
  async function disconnect() {
    connectionAttempt.current++;
    setBusy(false);
    // Invalidate reviews immediately, before waiting for connector sign-out.
    selectAccount("");
    try {
      await (await getConnector()).disconnect();
    } catch {
      setError("Could not disconnect. Try again.");
    }
  }
  async function send(call: Call, token: WalletSessionToken) {
    return sendWithSession(
      session,
      token,
      call,
      async () => (await getConnector()).wallet(),
      selectAccount,
    );
  }
  return (
    <Context.Provider
      value={{
        account,
        session,
        busy,
        error,
        connect,
        disconnect,
        send,
        clearError: () => setError(""),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function WalletControl() {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  return (
    <div className="wallet-control">
      <button
        className="button small"
        disabled={w.busy}
        onClick={() => (w.account ? setMenu(!menu) : void w.connect())}
        aria-expanded={w.account ? menu : undefined}
      >
        <Wallet size={17} />
        {w.busy ? "Connecting…" : w.account || "Connect wallet"}
      </button>
      {menu && (
        <div className="account-popover">
          <span className="eyebrow">NEAR TESTNET</span>
          <strong>{w.account}</strong>
          <button
            className="button secondary small"
            onClick={() => {
              setMenu(false);
              void w.disconnect();
            }}
          >
            <SignOut size={16} />
            Disconnect
          </button>
        </div>
      )}
      {w.error && (
        <div className="wallet-error" role="alert">
          {w.error}
          <button onClick={w.clearError}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

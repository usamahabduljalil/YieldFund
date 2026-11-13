import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  initialLedger,
  transition,
  assertInvariants,
  type Ledger,
  type Action,
} from "@yieldfund/domain";
const KEY = "yieldfund-preview-v1";
function restore(): Ledger {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw, (_k, v) =>
        v &&
        typeof v === "object" &&
        Object.keys(v).length === 1 &&
        typeof v.$bigint === "string"
          ? BigInt(v.$bigint)
          : v,
      ) as Ledger;
      assertInvariants(s);
      if (
        !Array.isArray(s.operations) ||
        !Array.isArray(s.withdrawals) ||
        !Array.isArray(s.proposals) ||
        !Number.isSafeInteger(s.nextId)
      )
        throw new Error();
      return s;
    }
  } catch {
    /* Invalid or unavailable local storage must not break the preview. */
  }
  return initialLedger();
}
type Store = {
  state: Ledger;
  act: (action: Action) => void;
  reset: () => void;
};
const Context = createContext<Store | null>(null);
export function PreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(restore);
  const current = useRef(state);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify(state, (_k, v) =>
          typeof v === "bigint" ? { $bigint: v.toString() } : v,
        ),
      );
    } catch {
      /* Private browsing can disable storage; the in-memory preview still works. */
    }
  }, [state]);
  const act = useCallback((action: Action) => {
    const next = transition(current.current, action);
    current.current = next;
    setState(next);
  }, []);
  const reset = useCallback(() => {
    const next = initialLedger();
    current.current = next;
    setState(next);
  }, []);
  return (
    <Context.Provider value={{ state, act, reset }}>
      {children}
    </Context.Provider>
  );
}
export function usePreview() {
  const value = useContext(Context);
  if (!value) throw new Error("Preview provider missing");
  return value;
}

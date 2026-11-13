// @vitest-environment jsdom
import { createElement, StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ChainClient,
  type Deployment,
  type Snapshot,
} from "../../../packages/near-client/src/chain";
import { WalletSession } from "./wallet-session";
import { ChainProvider, useChain } from "./chain-store";

const selected = vi.hoisted(() => ({ wallet: null as any }));
vi.mock("./wallet", () => ({ useWallet: () => selected.wallet }));
const deployment = {
  ...JSON.parse(readFileSync("deployments/testnet.json", "utf8")),
  transactionsEnabled: true,
} as Deployment;
let state: ReturnType<typeof useChain>;
function Probe() {
  state = useChain();
  return createElement(
    "output",
    { "data-testid": "position" },
    state.snapshot
      ? `${state.snapshot.accountId}:${state.snapshot.position?.nominal ?? "none"}`
      : "loading",
  );
}
function ui() {
  return createElement(ChainProvider, { deployment }, createElement(Probe));
}
function select(account: string) {
  selected.wallet.session.select(account);
  selected.wallet = { ...selected.wallet, account };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function snapshot(accountId = "alice.testnet"): Snapshot {
  return {
    accountId,
    height: 100,
    blockHash: "block",
    timestamp: Date.now(),
    fetchedAt: Date.now(),
    accounting: {
      mode: "funded_simulator",
      cash: "1000",
      nominal: "1000",
      backing: "1000",
      excluded: "0",
      shortfall: "0",
      eligible_yield: "0",
      strategy_book: "0",
      donated: "0",
      reserved_outbound: "0",
      settled: true,
      paused: false,
      needs_reconciliation: false,
      active_operation: null,
      queued_redemption: null,
      checkpoint_at: "0",
      state_version: "1",
    },
    position: accountId
      ? {
          nominal: accountId === "alice.testnet" ? "800" : "100",
          reserved: "0",
          deposited: "1000",
          withdrawn: "200",
        }
      : null,
    operations: [],
    proposals: [],
    proposalCount: 0,
    policy: deployment.daoPolicy,
    tokenBalance: "1000",
    treasuryBalance: "10",
    tokenRegistered: true,
    vaultRegistered: true,
    daoRegistered: true,
    costs: { position: "1", operation: "1" },
    tokenStorageCost: "1",
    strategy: { position: "0", busy: false },
    nativeBalance: "1000000000000000000000000",
  };
}
beforeEach(() => {
  localStorage.clear();
  selected.wallet = {
    account: "",
    session: new WalletSession(),
    send: vi.fn(),
  };
  select("alice.testnet");
  vi.spyOn(ChainClient.prototype, "snapshot").mockImplementation(
    async (account) => snapshot(account),
  );
  vi.spyOn(ChainClient.prototype, "checkFunding").mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Network forbidden in provider tests")),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("starts the new account read immediately while an old read is pending", async () => {
  const old = deferred<Snapshot>();
  vi.mocked(ChainClient.prototype.snapshot).mockImplementation((account) =>
    account === "alice.testnet"
      ? old.promise
      : Promise.resolve(snapshot(account)),
  );
  const view = render(ui());
  select("bob.testnet");
  await act(async () => {
    view.rerender(ui());
  });
  expect(ChainClient.prototype.snapshot).toHaveBeenCalledWith("bob.testnet");
  expect(screen.getByTestId("position").textContent).toBe("bob.testnet:100");
  await act(async () => {
    old.resolve(snapshot("alice.testnet"));
  });
  expect(screen.getByTestId("position").textContent).toBe("bob.testnet:100");
});

it("a refresh captured by an old receipt handler reads the current account", async () => {
  const view = render(ui());
  await act(async () => {});
  const oldRefresh = state.refresh;
  select("bob.testnet");
  await act(async () => {
    view.rerender(ui());
  });
  await act(async () => {
    await oldRefresh();
  });
  expect(ChainClient.prototype.snapshot).toHaveBeenLastCalledWith(
    "bob.testnet",
  );
  expect(screen.getByTestId("position").textContent).toBe("bob.testnet:100");
});

it("ignores errors from an account abandoned during a read", async () => {
  const old = deferred<Snapshot>();
  vi.mocked(ChainClient.prototype.snapshot).mockImplementation((account) =>
    account === "alice.testnet"
      ? old.promise
      : Promise.resolve(snapshot(account)),
  );
  const view = render(ui());
  select("bob.testnet");
  await act(async () => {
    view.rerender(ui());
  });
  await act(async () => {
    old.reject(new Error("Old account RPC failed"));
  });
  expect(state.error).toBe("");
  expect(state.loading).toBe(false);
  expect(screen.getByTestId("position").textContent).toBe("bob.testnet:100");
});

it("clears account-specific data on disconnect and reads public state", async () => {
  const view = render(ui());
  await act(async () => {});
  select("");
  await act(async () => {
    view.rerender(ui());
  });
  expect(screen.getByTestId("position").textContent).toBe(":none");
});

it("deduplicates refreshes for the same account and allows retry after failure", async () => {
  render(ui());
  await act(async () => {});
  const pending = deferred<Snapshot>();
  vi.mocked(ChainClient.prototype.snapshot).mockReturnValueOnce(
    pending.promise,
  );
  let first!: Promise<void>;
  await act(async () => {
    first = state.refresh();
    await state.refresh();
  });
  expect(ChainClient.prototype.snapshot).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending.reject(new Error("Read unavailable"));
    await first;
  });
  expect(state.error).toBe("Read unavailable");
  await act(async () => {
    await state.refresh();
  });
  expect(state.error).toBe("");
});

it("invalidates a prepared review after the selected account changes", async () => {
  const view = render(ui());
  await act(async () => {});
  let review!: Awaited<ReturnType<typeof state.prepare>>;
  await act(async () => {
    review = await state.prepare({
      kind: "withdraw",
      amount: "200",
      minimum: "200",
    });
  });
  select("bob.testnet");
  await act(async () => {
    view.rerender(ui());
  });
  await expect(state.submit(review)).rejects.toThrow("Account changed");
  expect(selected.wallet.send).not.toHaveBeenCalled();
  expect(state.submissions).toHaveLength(0);
});

it("rejects preparation if the account changes during funding checks", async () => {
  const funding = deferred<void>();
  vi.mocked(ChainClient.prototype.checkFunding).mockReturnValueOnce(
    funding.promise,
  );
  const view = render(ui());
  await act(async () => {});
  let result!: Promise<unknown>;
  await act(async () => {
    result = state
      .prepare({ kind: "withdraw", amount: "200", minimum: "200" })
      .catch((e) => e);
  });
  select("bob.testnet");
  await act(async () => {
    view.rerender(ui());
  });
  await act(async () => {
    funding.resolve();
  });
  expect(await result).toEqual(
    expect.objectContaining({ message: "Account changed. Review again." }),
  );
  expect(selected.wallet.send).not.toHaveBeenCalled();
  expect(state.submissions).toHaveLength(0);
});

it("survives StrictMode cleanup and makes captured refreshes inert after unmount", async () => {
  const view = render(createElement(StrictMode, null, ui()));
  await act(async () => {});
  expect(screen.getByTestId("position").textContent).toBe("alice.testnet:800");
  const refresh = state.refresh;
  view.unmount();
  const count = vi.mocked(ChainClient.prototype.snapshot).mock.calls.length;
  await refresh();
  expect(ChainClient.prototype.snapshot).toHaveBeenCalledTimes(count);
});

it("never exposes a snapshot tagged for another account", async () => {
  vi.mocked(ChainClient.prototype.snapshot).mockResolvedValue(
    snapshot("bob.testnet"),
  );
  render(ui());
  await act(async () => {});
  expect(state.snapshot).toBeNull();
  expect(screen.getByTestId("position").textContent).toBe("loading");
});

it.each([
  [{ code: 4001 }, "failed", "Wallet request rejected."],
  [new Error("Wallet closed"), "unknown", "Wallet outcome unconfirmed."],
])(
  "persists the distinction between rejection and ambiguous handoff (%s)",
  async (error, outcome, message) => {
    render(ui());
    await act(async () => {});
    let review!: Awaited<ReturnType<typeof state.prepare>>;
    await act(async () => {
      review = await state.prepare({
        kind: "withdraw",
        amount: "200",
        minimum: "200",
      });
    });
    selected.wallet.send.mockImplementation(async () => {
      expect(
        JSON.parse(localStorage.getItem("yieldfund:chain-submissions:v1")!)[0]
          .state,
      ).toBe("awaiting-wallet");
      throw error;
    });
    await act(async () => {
      await expect(state.submit(review)).rejects.toBe(error);
    });
    expect(state.submissions[0].state).toBe(outcome);
    expect(state.submissions[0].error).toContain(message);
    expect(selected.wallet.send).toHaveBeenCalledTimes(1);
  },
);

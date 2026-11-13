import { describe, expect, it, vi } from "vitest";
import {
  WalletSession,
  WalletNotSubmittedError,
  sendWithSession,
  walletFailure,
} from "./wallet-session";

const call = {
  receiverId: "vault.testnet",
  methodName: "advance_operation",
  args: { operation_id: "4" },
  gas: "300000000000000",
  deposit: "1",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const session = new WalletSession();
  session.select("alice.testnet");
  const token = session.capture();
  const wallet = {
    manifest: { features: { testnet: true } },
    getAccounts: vi.fn(async () => [{ accountId: "alice.testnet" }]),
    signAndSendTransaction: vi.fn(async () => ({
      transaction: { hash: "saved-hash" },
    })),
  };
  const getWallet = vi.fn(async () => wallet);
  const selectAccount = vi.fn((account: string) => session.select(account));
  const send = () =>
    sendWithSession(session, token, call, getWallet, selectAccount);
  return { session, token, wallet, getWallet, selectAccount, send };
}

describe("wallet session signing boundary", () => {
  it("dispatches mainnet only through a mainnet-bound session and wallet", async () => {
    const session = new WalletSession("mainnet");
    session.select("alice.near");
    const wallet = {
      manifest: { features: { mainnet: true } },
      getAccounts: vi.fn(async () => [{ accountId: "alice.near" }]),
      signAndSendTransaction: vi.fn(async () => ({
        transaction: { hash: "hash" },
      })),
    };
    const mainnetCall = { ...call, receiverId: "vault.near" };
    await sendWithSession(
      session,
      session.capture(),
      mainnetCall,
      async () => wallet,
      () => {},
    );
    expect(wallet.getAccounts).toHaveBeenCalledWith({ network: "mainnet" });
    expect(wallet.signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "mainnet",
        signerId: "alice.near",
        receiverId: "vault.near",
      }),
    );
  });
  it("rejects a review from another network even when account and revision match", async () => {
    const testnet = new WalletSession("testnet"),
      mainnet = new WalletSession("mainnet");
    testnet.select("ab".repeat(32));
    mainnet.select("ab".repeat(32));
    const getWallet = vi.fn();
    await expect(
      sendWithSession(mainnet, testnet.capture(), call, getWallet, () => {}),
    ).rejects.toThrow("network changed");
    expect(getWallet).not.toHaveBeenCalled();
  });
  it("refuses a mainnet handoff through a wallet supporting only testnet", async () => {
    const session = new WalletSession("mainnet");
    session.select("alice.near");
    const f = fixture();
    await expect(
      sendWithSession(session, session.capture(), call, f.getWallet, () => {}),
    ).rejects.toThrow("Choose a mainnet wallet");
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("requires a connected account to start a review", () => {
    expect(() => new WalletSession().capture()).toThrow(
      "Connect your testnet wallet",
    );
  });
  it("dispatches exactly the reviewed call once on testnet", async () => {
    const f = fixture();
    expect(await f.send()).toEqual({ transaction: { hash: "saved-hash" } });
    expect(f.wallet.getAccounts).toHaveBeenCalledWith({ network: "testnet" });
    expect(f.wallet.signAndSendTransaction).toHaveBeenCalledExactlyOnceWith({
      network: "testnet",
      signerId: "alice.testnet",
      receiverId: call.receiverId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: call.methodName,
            args: call.args,
            gas: call.gas,
            deposit: call.deposit,
          },
        },
      ],
    });
  });
  it.each(["", "bob.testnet"])(
    "blocks a stale review after selecting %j",
    async (account) => {
      const f = fixture();
      f.session.select(account);
      await expect(f.send()).rejects.toBeInstanceOf(WalletNotSubmittedError);
      expect(f.getWallet).not.toHaveBeenCalled();
    },
  );
  it("invalidates reviews after switching away and back to the same account", async () => {
    const f = fixture();
    f.session.select("");
    f.session.select("alice.testnet");
    await expect(f.send()).rejects.toThrow("Account changed");
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("blocks an account change while wallet lookup is in flight", async () => {
    const f = fixture(),
      gate = deferred<typeof f.wallet>();
    f.getWallet.mockReturnValueOnce(gate.promise);
    const pending = f.send();
    f.session.select("bob.testnet");
    gate.resolve(f.wallet);
    await expect(pending).rejects.toThrow("Account changed");
    expect(f.wallet.getAccounts).not.toHaveBeenCalled();
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("blocks a disconnect during wallet account verification", async () => {
    const f = fixture(),
      gate = deferred<Array<{ accountId: string }>>();
    const entered = deferred<void>();
    f.wallet.getAccounts.mockImplementationOnce(() => {
      entered.resolve();
      return gate.promise;
    });
    const pending = f.send();
    await entered.promise;
    f.session.select("");
    gate.resolve([{ accountId: "alice.testnet" }]);
    await expect(pending).rejects.toThrow("Account changed");
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("blocks wallets without testnet support", async () => {
    const f = fixture();
    f.wallet.manifest.features.testnet = false;
    await expect(f.send()).rejects.toThrow("Choose a testnet wallet");
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("updates an account changed inside the wallet and requires a new review", async () => {
    const f = fixture();
    f.wallet.getAccounts.mockResolvedValueOnce([{ accountId: "bob.testnet" }]);
    await expect(f.send()).rejects.toThrow("Wallet account changed");
    expect(f.selectAccount).toHaveBeenCalledWith("bob.testnet");
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it("classifies account lookup failures as definitely not submitted", async () => {
    const f = fixture();
    f.wallet.getAccounts.mockRejectedValueOnce(new TypeError("fetch failed"));
    const error = await f.send().catch((e: unknown) => e);
    expect(walletFailure(error)).toEqual({
      state: "failed",
      error: "Not submitted. Wallet checks failed. Review again.",
    });
    expect(f.wallet.signAndSendTransaction).not.toHaveBeenCalled();
  });
  it.each([4001, "USER_REJECTED"])(
    "retains explicit rejection %j without retry",
    async (code) => {
      const f = fixture(),
        error = Object.assign(new Error("Rejected"), { code });
      f.wallet.signAndSendTransaction.mockRejectedValueOnce(error);
      const result = await f.send().catch((e: unknown) => e);
      expect(result).toBe(error);
      expect(walletFailure(result)).toEqual({
        state: "failed",
        error: "Wallet request rejected.",
      });
      expect(f.wallet.signAndSendTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["Wallet closed", "fetch failed", "User rejected transaction"])(
    "keeps ambiguous error %j unknown",
    async (message) => {
      const f = fixture(),
        error = new Error(message);
      f.wallet.signAndSendTransaction.mockRejectedValueOnce(error);
      const result = await f.send().catch((e: unknown) => e);
      expect(result).toBe(error);
      expect(walletFailure(result).state).toBe("unknown");
      expect(f.wallet.signAndSendTransaction).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps a returned hash available after an account change during signing", async () => {
    const f = fixture(),
      gate = deferred<{ transaction: { hash: string } }>();
    const entered = deferred<void>();
    f.wallet.signAndSendTransaction.mockImplementationOnce(() => {
      entered.resolve();
      return gate.promise;
    });
    const pending = f.send();
    await entered.promise;
    f.session.select("bob.testnet");
    gate.resolve({ transaction: { hash: "original-account-hash" } });
    expect(await pending).toEqual({
      transaction: { hash: "original-account-hash" },
    });
    expect(f.wallet.signAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { createElement } from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { RegistryAction } from "./registry-action";
import { WalletSession } from "./wallet-session";
import { useWallet } from "./wallet";
import {
  CampaignRegistry,
  type RegistryDeployment,
} from "../../../packages/near-client/src/campaigns";
import {
  ChainClient,
  type Deployment,
} from "../../../packages/near-client/src/chain";
import { registryHistory } from "../../../packages/near-client/src/registry-actions";
vi.mock("./wallet", () => ({ useWallet: vi.fn() }));
const d = {
  network: "testnet",
  chainId: "testnet",
  rpcUrl: "https://test.rpc.fastnear.com",
  factoryId: "factory.testnet",
  factoryCodeHash: "a".repeat(64),
  verifierId: "verify.testnet",
  verifierCodeHash: "a".repeat(64),
  tokenId: "token.testnet",
  tokenDecimals: 6,
  vaultCodeHash: "a".repeat(64),
  strategyCodeHash: "a".repeat(64),
  transactionsEnabled: true,
} as RegistryDeployment;
const baseline = {} as Deployment;
const call = {
  receiverId: d.factoryId,
  methodName: "create_campaign",
  args: { id: "alpha" },
  deposit: "10",
  gas: "300000000000000",
};
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(CampaignRegistry.prototype, "snapshot").mockResolvedValue({
    height: 5,
    blockHash: "block",
    timestamp: "1",
    cost: "10",
    count: "0",
    campaigns: [],
    policy: {} as never,
  });
  vi.spyOn(ChainClient.prototype, "checkFunding").mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function wallet(send = vi.fn(async () => undefined)) {
  const session = new WalletSession();
  session.select("alice.testnet");
  vi.mocked(useWallet).mockReturnValue({
    account: "alice.testnet",
    network: "testnet",
    session,
    send,
    busy: false,
    error: "",
    connect: async () => {},
    disconnect: async () => {},
    clearError: () => {},
  });
  return { send, session };
}
async function prepare(build = vi.fn(async () => call)) {
  render(
    createElement(RegistryAction, {
      deployment: d,
      baseline,
      build,
      label: "Review creation",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review creation" }));
  await screen.findByRole("button", { name: "Confirm in wallet" });
  return build;
}
it("refuses a changed call before opening the wallet", async () => {
  const w = wallet();
  const build = vi
    .fn()
    .mockResolvedValueOnce(call)
    .mockResolvedValue({ ...call, deposit: "11" });
  await prepare(build);
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await screen.findByText("Review changed. Prepare it again.");
  expect(w.send).not.toHaveBeenCalled();
  expect(registryHistory(localStorage)).toEqual([]);
});
it("records explicit wallet rejection as failed and preserves the exact call", async () => {
  const w = wallet(
    vi.fn(async () => {
      throw Object.assign(Error("Rejected"), { code: 4001 });
    }),
  );
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await waitFor(() =>
    expect(registryHistory(localStorage)[0]?.state).toBe("failed"),
  );
  expect(w.send).toHaveBeenCalledTimes(1);
  expect(registryHistory(localStorage)[0].call).toEqual(call);
});
it("persists an unknown hashless handoff and blocks a second send", async () => {
  const w = wallet();
  await prepare();
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await waitFor(() =>
    expect(registryHistory(localStorage)[0]?.state).toBe("unknown"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review creation" }));
  await screen.findByText(
    "Resolve the existing registry transaction before sending another",
  );
  expect(w.send).toHaveBeenCalledTimes(1);
});
it("invalidates the signer during the final funding check", async () => {
  const w = wallet();
  await prepare();
  vi.mocked(ChainClient.prototype.checkFunding).mockImplementation(async () => {
    w.session.select("bob.testnet");
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm in wallet" }));
  await screen.findByText("Account changed. Review again.");
  expect(w.send).not.toHaveBeenCalled();
  expect(registryHistory(localStorage)).toEqual([]);
});

it("lets an edited draft prepare again while the old funding request is pending", async () => {
  const w = wallet();
  let finish!: () => void;
  vi.mocked(ChainClient.prototype.checkFunding).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const props = { deployment: d, baseline, label: "Review creation" };
  const build = vi.fn(async () => call);
  const view = render(createElement(RegistryAction, { ...props, build }));
  fireEvent.click(screen.getByRole("button", { name: "Review creation" }));
  await waitFor(() =>
    expect(ChainClient.prototype.checkFunding).toHaveBeenCalled(),
  );
  const edited = vi.fn(async () => ({ ...call, args: { id: "beta" } }));
  view.rerender(createElement(RegistryAction, { ...props, build: edited }));
  expect(
    (
      screen.getByRole("button", {
        name: "Review creation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  finish();
  fireEvent.click(screen.getByRole("button", { name: "Review creation" }));
  await screen.findByRole("button", { name: "Confirm in wallet" });
  expect(screen.getByText(/"beta"/)).toBeTruthy();
  expect(w.send).not.toHaveBeenCalled();
});

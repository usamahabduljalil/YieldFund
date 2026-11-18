// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChainBanner, ChainRoutes } from "./chain-pages";

const fixture = vi.hoisted(() => ({ state: null as any }));
vi.mock("./chain-store", () => ({ useChain: () => fixture.state }));
vi.mock("./wallet", () => ({
  useWallet: () => ({ account: "supporter.near" }),
}));
afterEach(cleanup);
function state(network = "mainnet") {
  fixture.state = {
    deployment: {
      network,
      strategyMode: "rhea_lending",
      tokenSymbol: "wNEAR",
      vaultId: "vault.near",
      transactionsEnabled: false,
      config: {
        token_decimals: 24,
        beneficiary_id: "community.sputnik-dao.near",
        guardian_id: "community.sputnik-dao.near",
        strategy_id: "contract.main.burrow.near",
      },
      codeHashes: {},
      authority: "Test fixture",
    },
    snapshot: {
      height: 1,
      timestamp: Date.now(),
      treasuryBalance: "1000000000000000000000001",
      accounting: { donated: "1" },
      costs: { operation: "100" },
      policy: { roles: [], default_vote_policy: { threshold: "2" } },
      proposals: [],
      proposalCount: 0,
    },
    loading: false,
    error: "",
    submissions: [],
    refresh: vi.fn(),
    prepare: vi.fn(),
  };
}
function page(path: string) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(ChainRoutes),
    ),
  );
}
it("shows exact 24-decimal token balances and the real treasury link without enabling signing", () => {
  state();
  page("/treasury");
  expect(screen.getByText("1.000000000000000000000001")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /Open Trezu/ }).getAttribute("href"),
  ).toBe("https://trezu.app/community.sputnik-dao.near");
  expect(
    (
      screen.getByRole("button", {
        name: "Review proposal",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.queryByText(/tUSD/)).toBeNull();
});
it("does not open Trezu on testnet", () => {
  state("testnet");
  page("/treasury");
  expect(screen.queryByRole("link", { name: /Open Trezu/ })).toBeNull();
});
it("exports DAO-bound templates from the current vault costs", () => {
  state();
  page("/manage");
  const link = screen.getByRole("link", { name: "Continue Rhea settlement" });
  const template = JSON.parse(
    decodeURIComponent(link.getAttribute("href")!.split(",")[1]),
  );
  expect(template.binding).toEqual({
    receiver_id: "vault.near",
    method_name: "continue_rhea_redemption",
    deposit: "1",
    gas: "260000000000000",
  });
  expect(
    screen.getByRole("link", { name: "Open templates" }).getAttribute("href"),
  ).toContain("community.sputnik-dao.near/custom-templates");
});
it("identifies mainnet Rhea explicitly in the banner", () => {
  state();
  render(createElement(ChainBanner));
  expect(screen.getByText("NEAR MAINNET")).toBeTruthy();
  expect(screen.getByText(/Rhea lending/).textContent).toContain("Read only");
  expect(screen.queryByText(/Simulated strategy/)).toBeNull();
});

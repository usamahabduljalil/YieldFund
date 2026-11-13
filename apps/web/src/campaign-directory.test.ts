// @vitest-environment jsdom
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignDirectory } from "./campaign-directory";
import type { Deployment } from "../../../packages/near-client/src/chain";
import { campaignMetadata } from "../../../packages/near-client/src/campaigns";

vi.mock("../../../packages/near-client/src/campaigns", async (original) => ({
  ...(await original<object>()),
  campaignMetadata: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const current = {
  config: { token_id: "token.testnet", token_decimals: 6 },
} as Deployment;
async function form() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ deployments: [] }) })),
  );
  render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/app/campaigns/new"] },
      createElement(CampaignDirectory, { current }),
    ),
  );
  await screen.findByText("Draft only");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Community" },
  });
  fireEvent.change(screen.getByLabelText("Campaign ID"), {
    target: { value: "community" },
  });
  fireEvent.change(screen.getByLabelText("Treasury DAO"), {
    target: { value: "dao.testnet" },
  });
  fireEvent.change(screen.getByLabelText("Deposit cap"), {
    target: { value: "1000" },
  });
}
describe("campaign draft isolation", () => {
  it("discards an in-flight review after the user edits a field", async () => {
    let finish!: (value: { content: string; hash: string }) => void;
    vi.mocked(campaignMetadata).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await form();
    fireEvent.click(screen.getByRole("button", { name: "Review campaign" }));
    expect(
      screen
        .getByRole("button", { name: "Checking…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Treasury DAO"), {
      target: { value: "new-dao.testnet" },
    });
    await act(async () => {
      finish({ content: "{}", hash: "a".repeat(64) });
    });
    expect(screen.queryByText("Review Community")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save campaign draft" }),
    ).toBeNull();
  });
  it("removes the testnet draft when browsing mainnet", async () => {
    vi.mocked(campaignMetadata).mockResolvedValue({
      content: "{}",
      hash: "a".repeat(64),
    });
    await form();
    fireEvent.click(screen.getByRole("button", { name: "Review campaign" }));
    await screen.findByText("Review Community");
    fireEvent.change(screen.getByLabelText("Browse network"), {
      target: { value: "mainnet" },
    });
    expect(screen.queryByText("Review Community")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Save campaign draft" }),
    ).toBeNull();
    expect(
      screen.getByText("Mainnet creation is not available yet."),
    ).toBeTruthy();
  });
});

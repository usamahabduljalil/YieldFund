import { describe, it, expect } from "vitest";
import {
  trezuLinks,
  verificationTemplates,
  yieldSettlementTemplate,
  rheaOperationTemplates,
} from "./trezu";
describe("Trezu integration boundaries", () => {
  it("does not misroute testnet treasuries into mainnet", () => {
    expect(() => trezuLinks("testnet", "dao.testnet")).toThrow();
    expect(() => trezuLinks("mainnet", "dao.testnet")).toThrow();
    expect(trezuLinks("mainnet", "dao.sputnik-dao.near").createTemplate).toBe(
      "https://trezu.app/dao.sputnik-dao.near/custom-templates/create",
    );
  });
  it("binds verification to the exact factory and passes U64 as a string", () => {
    const [verify, revoke] = verificationTemplates("factory.near");
    expect(verify.binding).toEqual({
      receiver_id: "factory.near",
      method_name: "verify_campaign",
      deposit: "1",
      gas: "30000000000000",
    });
    expect(verify.args.expires_at).toBe("{{expires_at}}");
    expect(revoke.binding.method_name).toBe("revoke_verification");
    expect(verify.fields.some((f) => f.name === "receiver_id")).toBe(false);
    expect(() => verificationTemplates("{{receiver}}")).toThrow();
  });
  it("preserves storage and token integers above JS safe precision", () => {
    const template = yieldSettlementTemplate(
      "vault.near",
      "20480000000000000000001",
    );
    expect(template.binding.deposit).toBe("20480000000000000000001");
    expect(template.fields[0].type).toBe("uint");
    expect(() => yieldSettlementTemplate("vault.near", "0")).toThrow();
    expect(() => yieldSettlementTemplate("vault.near", "2e22")).toThrow();
  });
  it("pins Rhea continuation to the versioned contract method and full gas budget", () => {
    const templates = rheaOperationTemplates(
      "vault.near",
      "20480000000000000000001",
    );
    const continuation = templates.find((t) => t.id === "yieldfund-continue")!;
    expect(continuation.binding).toMatchObject({
      method_name: "continue_rhea_redemption",
      gas: "260000000000000",
      deposit: "1",
    });
    expect(continuation.args).toEqual({
      operation_id: "{{operation_id}}",
      version: "{{version}}",
    });
    expect(templates.every((t) => t.binding.receiver_id === "vault.near")).toBe(
      true,
    );
  });
});

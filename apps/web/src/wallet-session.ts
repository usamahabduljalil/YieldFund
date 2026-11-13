import type { Call } from "../../../packages/near-client/src/chain";
import { isWalletRejection } from "../../../packages/near-client/src/actions";

export type WalletSessionToken = Readonly<{
  account: string;
  revision: number;
}>;

/** Only used when the signing method has definitely not been invoked. */
export class WalletNotSubmittedError extends Error {}

export class WalletSession {
  private account = "";
  private revision = 0;

  select(account: string) {
    this.account = account;
    this.revision++;
  }

  capture(): WalletSessionToken {
    if (!this.account)
      throw new WalletNotSubmittedError("Connect your testnet wallet first.");
    return Object.freeze({ account: this.account, revision: this.revision });
  }

  assert(token: WalletSessionToken) {
    if (
      !token.account ||
      token.account !== this.account ||
      token.revision !== this.revision
    )
      throw new WalletNotSubmittedError("Account changed. Review again.");
  }
}

interface SigningWallet {
  manifest: { features: { testnet?: boolean } };
  getAccounts(params: {
    network: "testnet";
  }): Promise<Array<{ accountId: string }>>;
  signAndSendTransaction(params: {
    network: "testnet";
    signerId: string;
    receiverId: string;
    actions: Array<{
      type: "FunctionCall";
      params: {
        methodName: string;
        args: Call["args"];
        gas: string;
        deposit: string;
      };
    }>;
  }): Promise<unknown>;
}

export async function sendWithSession(
  session: WalletSession,
  token: WalletSessionToken,
  call: Call,
  getWallet: () => Promise<SigningWallet>,
  selectAccount: (account: string) => void,
) {
  let wallet: SigningWallet;
  try {
    session.assert(token);
    wallet = await getWallet();
    session.assert(token);
    if (!wallet.manifest.features.testnet)
      throw new WalletNotSubmittedError("Choose a testnet wallet.");
    const accounts = await wallet.getAccounts({ network: "testnet" });
    session.assert(token);
    if (!accounts.some((a) => a.accountId === token.account)) {
      selectAccount(accounts[0]?.accountId ?? "");
      throw new WalletNotSubmittedError(
        "Wallet account changed. Review again.",
      );
    }
  } catch (error) {
    if (error instanceof WalletNotSubmittedError) throw error;
    throw new WalletNotSubmittedError("Wallet checks failed. Review again.");
  }
  // No await between this final session check and the signing handoff.
  // Errors after this boundary must retain their original, possibly unknown outcome.
  session.assert(token);
  return wallet.signAndSendTransaction({
    network: "testnet",
    signerId: token.account,
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
}

export function walletFailure(error: unknown): {
  state: "failed" | "unknown";
  error: string;
} {
  if (error instanceof WalletNotSubmittedError)
    return { state: "failed", error: `Not submitted. ${error.message}` };
  if (isWalletRejection(error))
    return { state: "failed", error: "Wallet request rejected." };
  return {
    state: "unknown",
    error: "Wallet outcome unconfirmed. Check wallet history before retrying.",
  };
}

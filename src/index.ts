import { createContext } from "react";
import { JsonRpcProvider } from "@near-js/providers";
import { Account } from "@near-js/accounts";
import { KeyPair } from "@near-js/crypto";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
import type { FinalExecutionOutcome } from "@near-js/types";
import type {
  SignAndSendTransactionParams,
  SignAndSendTransactionsParams,
  NearWalletBase,
  WalletPlugin
} from "@hot-labs/near-connect";

export const NearContext = createContext<any>(undefined);

const STORAGE_KEY = `access_key::plugin`;

interface AccessKeyData {
  accountId: string;
  privateKey: string;
  contractId: string;
  allowedMethods: string[];
  allowance: string;
}

export interface CreateAccessKeyParams {
  wallet: NearWalletBase;
  contractId: string;
  methodNames?: string[];
  allowance?: string;
}

const shouldUseAccessKey = (tx: SignAndSendTransactionParams): boolean => {
  if (!localStorage.getItem(STORAGE_KEY)) {
    return false;
  }

  const key: AccessKeyData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);

  if (tx.receiverId !== key.contractId) return false;

  for (const action of tx.actions) {
    if (action.type !== "FunctionCall") return false;
    if (!key.allowedMethods.includes(action.params.methodName!)) return false;
  }

  return true;
};

const signTransactionLocally = async (
  tx: SignAndSendTransactionParams
): Promise<FinalExecutionOutcome> => {
  const keyData: AccessKeyData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);

  const rpcUrl =
    tx.network === "mainnet"
      ? "https://rpc.fastnear.com"
      : "https://test.rpc.fastnear.com";
  const provider = new JsonRpcProvider({ url: rpcUrl });

  const keyPair = KeyPair.fromString(keyData.privateKey as any);
  const signer = new KeyPairSigner(keyPair);
  const account = new Account(keyData.accountId, provider, signer);

  const actions = tx.actions.map((action) => {
    if (action.type === "FunctionCall") {
      return actionCreators.functionCall(
        action.params.methodName!,
        action.params.args,
        BigInt(action.params.gas || "30000000000000"),
        BigInt(action.params.deposit || "0")
      );
    }
    throw new Error(`Unsupported action type: ${action.type}`);
  });

  const result = await account.signAndSendTransaction({
    receiverId: tx.receiverId,
    actions,
  });
  return result;
};

export const AccessKeyPlugin: WalletPlugin = {
  async signOut(
    params?: { network?: "mainnet" | "testnet" },
    next?: () => Promise<void>
  ): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    return next!();
  },

  async signAndSendTransaction(
    params: SignAndSendTransactionParams,
    next: () => Promise<FinalExecutionOutcome>
  ): Promise<FinalExecutionOutcome> {
    if (shouldUseAccessKey(params)) {
      return signTransactionLocally(params);
    }
    return next();
  },

  async signAndSendTransactions(
    params: SignAndSendTransactionsParams,
    next: () => Promise<FinalExecutionOutcome[]>
  ): Promise<FinalExecutionOutcome[]> {
    const allCanUseAccessKey = params.transactions.every((tx) =>
      shouldUseAccessKey(tx)
    );

    if (allCanUseAccessKey) {
      const results: FinalExecutionOutcome[] = [];
      for (const tx of params.transactions) {
        const result = await signTransactionLocally(tx);
        results.push(result);
      }
      return results;
    }

    return next();
  },

  async createAccessKey({
    wallet,
    contractId,
    methodNames,
    allowance,
  }: CreateAccessKeyParams): Promise<FinalExecutionOutcome> {
    allowance = allowance || "250000000000000000000000";
    const walletAccounts = await wallet.getAccounts();
    console.log(wallet.manifest.id);

    const accountId = walletAccounts[0]?.accountId;

    const keyPair = KeyPair.fromRandom("ed25519");
    const newPublicKey = keyPair.getPublicKey().toString();
    const privateKey = keyPair.toString();

    const result = await wallet.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        {
          type: "AddKey",
          params: {
            publicKey: newPublicKey,
            accessKey: {
              permission: {
                receiverId: contractId,
                methodNames: methodNames || [],
                allowance,
              },
            },
          },
        },
      ],
    });

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        accountId,
        privateKey,
        contractId: contractId,
        allowedMethods: methodNames,
        allowance: allowance || "250000000000000000000000",
      })
    );

    return result;
  },
};

export default AccessKeyPlugin;

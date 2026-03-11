import { createContext } from "react";
import {
  JsonRpcProvider,
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  nearToYocto,
} from "near-api-js";
import type { FinalExecutionOutcome } from "near-api-js";
import type {
  SignAndSendTransactionParams,
  SignAndSendTransactionsParams,
} from "@hot-labs/near-connect/build/types";
import type { WalletPlugin } from "@hot-labs/near-connect/build/types/plugin";
import type { ConnectorAction } from "@hot-labs/near-connect/build/actions/types";

export const NearContext = createContext<any>(undefined);

const STORAGE_KEY = `access_key::plugin`;

interface AccessKeyData {
  privateKey: string;
  contractId: string;
  allowedMethods: string[];
  allowance: string;
}

export interface CreateAccessKeyParams {
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
  accountId: string,
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
  const account = new Account(accountId, provider, signer);

  const transactionActions = tx.actions.map((action: ConnectorAction) => {
    if (action.type === "FunctionCall") {
      return actions.functionCall(
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
    actions: transactionActions,
  });
  return result as unknown as FinalExecutionOutcome;
};

export const FunctionCallKeyPlugin: WalletPlugin = {
  async signOut(
    _: unknown,
    next?: () => Promise<void>
  ): Promise<void> {
    localStorage.removeItem(STORAGE_KEY);
    return next!();
  },

  async signAndSendTransaction(
    this,
    params: SignAndSendTransactionParams,
    next: () => Promise<FinalExecutionOutcome>
  ): Promise<FinalExecutionOutcome> {
    let accountId = params.signerId;
    if (!accountId) {
      // @ts-ignore
      const accounts = await this.getAccounts();
      accountId = accounts[0]?.accountId;
      if (!accountId) {
        throw new Error("No signed-in account found");
      }
    }

    if (shouldUseAccessKey(params)) {
      return signTransactionLocally(accountId, params);
    }
    return next();
  },

  async signAndSendTransactions(
    this,
    params: SignAndSendTransactionsParams,
    next: () => Promise<FinalExecutionOutcome[]>
  ): Promise<FinalExecutionOutcome[]> {
    const allCanUseAccessKey = params.transactions.every((tx) =>
      shouldUseAccessKey(tx)
    );

    let accountId = params.signerId;
    if (!accountId) {
      // @ts-ignore
      const accounts = await this.getAccounts();
      accountId = accounts[0]?.accountId;
      if (!accountId) {
        throw new Error("No signed-in account found");
      }
    }

    if (allCanUseAccessKey) {
      const results: FinalExecutionOutcome[] = [];
      for (const tx of params.transactions) {
        const result = await signTransactionLocally(accountId, tx);
        results.push(result);
      }
      return results;
    }

    return next();
  },

  createAccessKey({
    contractId,
    methodNames,
    allowance,
  }: CreateAccessKeyParams): string {
    const resolvedAllowance = allowance ?? nearToYocto(0.25).toString();

    const keyPair = KeyPair.fromRandom("ed25519");
    const newPublicKey = keyPair.getPublicKey().toString();
    const privateKey = keyPair.toString();

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        privateKey,
        contractId: contractId,
        allowedMethods: methodNames,
        allowance: resolvedAllowance,
      })
    );

    return newPublicKey;
  },
};

export default FunctionCallKeyPlugin;

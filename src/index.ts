import { createContext } from "react";
import {
  JsonRpcProvider,
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  teraToGas,
  FailoverRpcProvider,
} from "near-api-js";
import type { FinalExecutionOutcome, Provider } from "near-api-js";
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
  methodNames: string[];
  allowance: string;
}

export interface CreateAccessKeyParams {
  contractId: string;
  methodNames: string[];
  allowance: string;
}

export interface CreateAccessKeyPluginParams {
  network: "mainnet" | "testnet";
  providers?: {
    mainnet?: string[];
    testnet?: string[];
  };
}

export type AccessKeyPlugin = WalletPlugin & {
  /**
   * Generates a local ed25519 key pair and stores its private key alongside
   * access key constraints in localStorage.
   *
   * @param params Access key restrictions for contract, methods, and allowance.
   * @param params.contractId The NEAR account ID of the contract this access key should be restricted to.
   * @param params.methodNames An array of method names this access key can call; use [] to allow all methods.
   * @param params.allowance The maximum amount of NEAR (in yoctoNEAR) that can be spent using this access key; use "0" for unlimited allowance.
   * @returns The generated public key to register on-chain as a function-call access key.
   */
  createLocalKeyFor: (params: CreateAccessKeyParams) => string;
};

const getStoredAccessKey = (): AccessKeyData | null => {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) return null;

  try {
    return JSON.parse(serialized) as AccessKeyData;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

const shouldUseAccessKey = (tx: SignAndSendTransactionParams): boolean => {
  const key = getStoredAccessKey();
  if (!key) return false;

  if (tx.receiverId !== key.contractId) return false;

  for (const action of tx.actions) {
    if (action.type !== "FunctionCall") return false;
    if (key.methodNames.length > 0 && !key.methodNames.includes(action.params.methodName!)) return false;
    // function-call keys cannot attach deposits, the protocol rejects the tx
    // with AccessKeyDepositWithFunctionCallActionError; route to the wallet instead
    if (BigInt(action.params.deposit || "0") > 0n) return false;
  }

  return true;
};

const signTransactionLocally = async (
  accountId: string,
  provider: Provider,
  tx: SignAndSendTransactionParams
): Promise<FinalExecutionOutcome> => {
  const keyData = getStoredAccessKey();
  if (!keyData) {
    throw new Error("No local access key found");
  }

  const keyPair = KeyPair.fromString(keyData.privateKey as any);
  const signer = new KeyPairSigner(keyPair);
  const account = new Account(accountId, provider, signer);

  const transactionActions = tx.actions.map((action: ConnectorAction) => {
    if (action.type === "FunctionCall") {
      return actions.functionCall(
        action.params.methodName!,
        action.params.args,
        BigInt(action.params.gas || teraToGas(30)),
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

const resolveProvider = ({
  network,
  providers = {
    testnet: [],
    mainnet: [],
  }
}: CreateAccessKeyPluginParams): FailoverRpcProvider => {
  const defaultProviders = {
    mainnet: ["https://free.rpc.fastnear.com"],
    testnet: ["https://rpc.testnet.fastnear.com"],
  };
  const networkProviders = providers[network]?.length? providers[network] : defaultProviders[network];
  return new FailoverRpcProvider(networkProviders.map((url) => new JsonRpcProvider({ url })));
};

const resolveSignerId = async (
  pluginContext: unknown,
  signerId?: string
): Promise<string> => {
  if (signerId) return signerId;

  const contextWithAccounts = pluginContext as {
    getAccounts?: () => Promise<Array<{ accountId: string }>>;
  };
  const accounts = await contextWithAccounts.getAccounts?.();
  const accountId = accounts?.[0]?.accountId;

  if (!accountId) {
    throw new Error("No signed-in account found");
  }

  return accountId;
};

/**
 * Creates a wallet plugin that can locally sign eligible function-call
 * transactions using a browser-stored access key.
 *
 * @param params Network and optional RPC provider configuration.
 * @param params.network The NEAR network to connect to ("mainnet" or "testnet").
 * @param params.providers Optional custom RPC URLs for each network; if not provided, defaults will be used.
 * @returns A wallet plugin that intercepts signing flows and exposes `createLocalKeyFor` to generate and persist local key material.
 */
export const createAccessKeyPlugin = (
  params: CreateAccessKeyPluginParams
): AccessKeyPlugin => {
  const provider = resolveProvider(params);

  return {

    async signOut(
      _: unknown,
      next?: () => Promise<void>
    ): Promise<void> {
      localStorage.removeItem(STORAGE_KEY);
      if (next) {
        await next();
      }
    },

    async signAndSendTransaction(
      this,
      params: SignAndSendTransactionParams,
      next: () => Promise<FinalExecutionOutcome>
    ): Promise<FinalExecutionOutcome> {
      const accountId = await resolveSignerId(this, params.signerId);

      if (shouldUseAccessKey(params)) {
        return signTransactionLocally(accountId, provider, params);
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

      const accountId = await resolveSignerId(this, params.signerId);

      if (allCanUseAccessKey) {
        const results: FinalExecutionOutcome[] = [];
        for (const tx of params.transactions) {
          const result = await signTransactionLocally(accountId, provider, tx);
          results.push(result);
        }
        return results;
      }

      return next();
    },

    createLocalKeyFor({ contractId, methodNames, allowance }: CreateAccessKeyParams): string {
      const keyPair = KeyPair.fromRandom("ed25519");
      const newPublicKey = keyPair.getPublicKey().toString();
      const privateKey = keyPair.toString();

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          privateKey,
          contractId,
          methodNames,
          allowance,
        })
      );

      return newPublicKey;

    },
  };
};
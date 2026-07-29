import {
  JsonRpcProvider,
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  FailoverRpcProvider,
} from "near-api-js";
import type {
  Action,
  FinalExecutionOutcome,
  KeyPairString,
  Provider,
} from "near-api-js";
import type {
  Account as NearAccount,
  SignInParams,
  SignAndSendTransactionParams,
  SignAndSendTransactionsParams,
} from "@hot-labs/near-connect/build/types";
import { nearActionsToConnectorActions } from "@hot-labs/near-connect/build/actions/index.js";
import type { WalletPlugin } from "@hot-labs/near-connect/build/types/plugin";

const DEFAULT_ALLOWANCE = "250000000000000000000000";
const LEGACY_STORAGE_KEY = "access_key::plugin";

interface AccessKeyData {
  privateKey: KeyPairString;
  contractId: string;
  methodNames: string[];
}

export interface CreateAccessKeyPluginParams {
  network: "mainnet" | "testnet";
  providers?: {
    mainnet?: string[];
    testnet?: string[];
  };
  signIn?: {
    contractId: string;
    methodNames?: string[];
    allowance?: string;
  };
}

const storageKeyFor = (
  network: CreateAccessKeyPluginParams["network"],
  accountId: string
): string => `access_key::plugin::${network}::${accountId}`;

const getStoredAccessKey = (
  network: CreateAccessKeyPluginParams["network"],
  accountId: string
): AccessKeyData | null => {
  if (typeof localStorage === "undefined") return null;

  const storageKey = storageKeyFor(network, accountId);
  const serialized = localStorage.getItem(storageKey);
  if (!serialized) return null;

  try {
    return JSON.parse(serialized) as AccessKeyData;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
};

const storeAccessKey = (
  network: CreateAccessKeyPluginParams["network"],
  accountId: string,
  key: AccessKeyData
): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKeyFor(network, accountId), JSON.stringify(key));
};

const removeStoredAccessKey = (
  network: CreateAccessKeyPluginParams["network"],
  accountId: string
): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKeyFor(network, accountId));
};

const removeLegacyStoredAccessKey = (): void => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LEGACY_STORAGE_KEY);
};

const shouldUseAccessKey = (
  key: AccessKeyData,
  tx: SignAndSendTransactionParams
): boolean => {
  if (tx.receiverId !== key.contractId) return false;

  for (const action of nearActionsToConnectorActions(tx.actions)) {
    if (action.type !== "FunctionCall") return false;
    if (
      key.methodNames.length > 0 &&
      !key.methodNames.includes(action.params.methodName)
    ) {
      return false;
    }
    if (BigInt(action.params.deposit) > 0n) return false;
  }

  return true;
};

const signTransactionLocally = async (
  accountId: string,
  provider: Provider,
  keyData: AccessKeyData,
  tx: SignAndSendTransactionParams
): Promise<FinalExecutionOutcome> => {
  const keyPair = KeyPair.fromString(keyData.privateKey);
  const signer = new KeyPairSigner(keyPair);
  const account = new Account(accountId, provider, signer);

  const transactionActions: Action[] = tx.actions.map((action) => {
    if (!("type" in action)) {
      return action;
    }

    if (action.type === "FunctionCall") {
      return actions.functionCall(
        action.params.methodName,
        action.params.args,
        BigInt(action.params.gas),
        BigInt(action.params.deposit)
      );
    }
    throw new Error("Unsupported action type");
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
  },
}: CreateAccessKeyPluginParams): FailoverRpcProvider => {
  const defaultProviders = {
    mainnet: ["https://free.rpc.fastnear.com"],
    testnet: ["https://rpc.testnet.fastnear.com"],
  };
  const networkProviders = providers[network]?.length
    ? providers[network]
    : defaultProviders[network];
  return new FailoverRpcProvider(
    networkProviders.map((url) => new JsonRpcProvider({ url }))
  );
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
 * @returns A wallet plugin that automatically creates and registers a local function-call key during sign-in.
 */
export const createAccessKeyPlugin = (
  params: CreateAccessKeyPluginParams
): WalletPlugin => {
  removeLegacyStoredAccessKey();

  const network = params.network;
  const provider = resolveProvider(params);
  const signInParams = params.signIn
    ? {
      contractId: params.signIn.contractId,
      methodNames: params.signIn.methodNames ?? [],
      allowance: params.signIn.allowance ?? DEFAULT_ALLOWANCE,
    }
    : null;

  return {
    async signIn(
      data: SignInParams | undefined,
      next: () => Promise<NearAccount[]>
    ): Promise<NearAccount[]> {
      if (!signInParams || !data) {
        return next();
      }

      const keyPair = KeyPair.fromRandom("ed25519");
      data.addFunctionCallKey = {
        contractId: signInParams.contractId,
        publicKey: keyPair.getPublicKey().toString(),
        allowMethods: signInParams.methodNames.length
          ? {
            anyMethod: false,
            methodNames: signInParams.methodNames,
          }
          : { anyMethod: true },
        gasAllowance:
          signInParams.allowance === "0"
            ? { kind: "unlimited" }
            : {
              kind: "limited",
              amount: signInParams.allowance,
            },
      };

      const accounts = await next();
      const accountId = accounts[0]?.accountId;

      if (accountId) {
        storeAccessKey(network, accountId, {
          privateKey: keyPair.toString(),
          contractId: signInParams.contractId,
          methodNames: signInParams.methodNames,
        });
      }

      return accounts;
    },

    async signOut(
      this,
      _: unknown,
      next?: () => Promise<void>
    ): Promise<void> {
      const contextWithAccounts = this as {
        getAccounts?: () => Promise<Array<{ accountId: string }>>;
      };
      const accounts = await contextWithAccounts.getAccounts?.() ?? [];

      if (next) {
        await next();
      }

      for (const { accountId } of accounts) {
        removeStoredAccessKey(network, accountId);
      }
    },

    async signAndSendTransaction(
      this,
      params: SignAndSendTransactionParams,
      next: () => Promise<FinalExecutionOutcome>
    ): Promise<FinalExecutionOutcome> {
      const accountId = await resolveSignerId(this, params.signerId);
      const keyData = getStoredAccessKey(network, accountId);

      if (!keyData || !shouldUseAccessKey(keyData, params)) {
        return next();
      }

      try {
        return await signTransactionLocally(
          accountId,
          provider,
          keyData,
          params
        );
      } catch {
        return next();
      }
    },

    async signAndSendTransactions(
      this,
      params: SignAndSendTransactionsParams,
      next: () => Promise<FinalExecutionOutcome[]>
    ): Promise<FinalExecutionOutcome[]> {
      const accountId = await resolveSignerId(this, params.signerId);
      const keyData = getStoredAccessKey(network, accountId);

      if (
        !keyData ||
        !params.transactions.every((tx) => shouldUseAccessKey(keyData, tx))
      ) {
        return next();
      }

      const results: FinalExecutionOutcome[] = [];
      try {
        for (const tx of params.transactions) {
          const result = await signTransactionLocally(
            accountId,
            provider,
            keyData,
            tx
          );
          results.push(result);
        }
        return results;
      } catch {
        return next();
      }
    },
  };
};

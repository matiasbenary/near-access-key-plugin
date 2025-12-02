# NEAR Access Key Plugin

A plugin for seamless transaction signing with NEAR function call access keys. This plugin allows you to create and use function call access keys to sign transactions locally without requiring wallet popups for every transaction.

## Features

- Create function call access keys with specific permissions
- Automatically sign eligible transactions locally using stored access keys
- Fallback to wallet signing for transactions that don't match access key permissions
- Support for both mainnet and testnet
- TypeScript support

## Installation

```bash
yarn add @near-access-key/plugin
```

## Usage

### Basic Setup

```typescript
import { AccessKeyPlugin } from '@near-access-key/plugin';

// The plugin integrates with NEAR wallet connectors
// and automatically intercepts transaction signing
```

### Creating an Access Key

```typescript
// Create an access key for a specific contract
await AccessKeyPlugin.createAccessKey({
  wallet: yourWalletInstance,
  contractId: 'your-contract.near',
  methodNames: ['method1', 'method2'], // Optional: restrict to specific methods
  allowance: '250000000000000000000000' // Optional: default is 0.25 NEAR
});
```

### How It Works

1. **Transaction Interception**: When you call `signAndSendTransaction`, the plugin checks if the transaction matches the stored access key permissions.

2. **Automatic Local Signing**: If the transaction:
   - Targets the same contract as the access key
   - Only contains `FunctionCall` actions
   - Calls methods in the allowed methods list

   Then it will be signed locally using the stored private key, without requiring a wallet popup.

3. **Fallback to Wallet**: If the transaction doesn't match the access key criteria, it falls back to the standard wallet signing flow.

### Plugin Methods

#### `createAccessKey(params)`

Creates a new function call access key and stores it in localStorage.

Parameters:
- `wallet`: The wallet instance to use for creating the access key
- `contractId`: The contract that the access key can interact with
- `methodNames`: (Optional) Array of method names the key can call
- `allowance`: (Optional) Maximum NEAR the key can spend (default: 0.25 NEAR)

#### `signAndSendTransaction(tx, next)`

Automatically called when signing transactions. Signs locally if criteria are met, otherwise calls `next()`.

#### `signAndSendTransactions(txs, next)`

Handles batch transaction signing. If all transactions in the array match the access key criteria, signs them all locally in sequence. Otherwise, falls back to wallet signing via `next()`.

Parameters:
- `txs`: Array of transactions to sign
- `next`: Fallback function to use wallet signing

Returns: Array of transaction results when signed locally

#### `signOut(args, next)`

Removes the stored access key from localStorage when the user signs out.

## Storage

The plugin stores access key data in `localStorage` under the key `access_key::plugin`. This includes:
- Account ID
- Private key (encrypted in browser storage)
- Contract ID
- Allowed methods
- Allowance

## Security Considerations

- Access keys are stored in localStorage and should only be used for low-value transactions
- The allowance limits how much NEAR the key can spend
- Keys are scoped to specific contracts and methods
- Keys are automatically removed on sign out

## Example Integration

### Complete React Context Example

```typescript
import { createContext, useContext, useEffect, useState, useMemo } from "react";
import { NearConnector } from "@hot-labs/near-connect";
import { AccessKeyPlugin } from "@near-access-key/plugin";

export const NearContext = createContext(undefined);

export function NearProvider({
  children,
  network = "testnet",
  contractId,
  allowedMethods = []
}) {
  const [wallet, setWallet] = useState(undefined);
  const [signedAccountId, setSignedAccountId] = useState("");
  const [loading, setLoading] = useState(true);

  // Initialize connector with plugin
  const connector = useMemo(() => {
    const conn = new NearConnector({
      network,
      logger: {
        log: (...logs) => console.log("[NEAR-CONNECTOR]", ...logs),
      },
    });

    // Add the AccessKeyPlugin to the connector
    conn.use(AccessKeyPlugin);

    return conn;
  }, [network]);

  useEffect(() => {
    async function initializeConnector() {
      try {
        const connectedWallet = await connector.getConnectedWallet();

        if (connectedWallet) {
          setWallet(connectedWallet.wallet);
          setSignedAccountId(connectedWallet.accounts[0]?.accountId || "");
        }
      } catch (error) {
        console.log("No wallet connected");
      }

      // Listen for wallet events
      const onSignOut = () => {
        setWallet(undefined);
        setSignedAccountId("");
      };

      const onSignIn = async (payload) => {
        setWallet(payload.wallet);
        const accounts = await payload.wallet.getAccounts();
        setSignedAccountId(accounts[0]?.accountId || "");
      };

      connector.on("wallet:signOut", onSignOut);
      connector.on("wallet:signIn", onSignIn);

      setLoading(false);
    }

    initializeConnector();

    return () => {
      connector.removeAllListeners("wallet:signOut");
      connector.removeAllListeners("wallet:signIn");
    };
  }, [connector]);

  async function signIn() {
    const connectedWallet = await connector.connect();
    if (connectedWallet) {
      setWallet(connectedWallet);
      const accounts = await connectedWallet.getAccounts();
      setSignedAccountId(accounts[0]?.accountId || "");
    }
  }

  async function signOut() {
    await connector.disconnect(wallet);
    setWallet(undefined);
    setSignedAccountId("");
  }

  // Create access key for seamless transactions
  async function createKey() {
    if (!wallet || !contractId) {
      throw new Error("Wallet and contract ID are required");
    }

    await AccessKeyPlugin.createAccessKey({
      wallet,
      contractId,
      methodNames: allowedMethods,
      allowance: "250000000000000000000000", // 0.25 NEAR
    });
  }

  // Helper to call contract methods
  async function callFunction(
    contractId,
    method,
    args = {},
    gas = "30000000000000",
    deposit = "0"
  ) {
    if (!wallet) {
      throw new Error("Wallet is not connected");
    }

    // This will automatically use the access key if available
    return await wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: method,
            args,
            gas,
            deposit,
          },
        },
      ],
    });
  }

  const value = {
    signedAccountId,
    wallet,
    signIn,
    signOut,
    createKey,
    callFunction,
    loading,
    connector,
  };

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
}

export function useNEAR() {
  const context = useContext(NearContext);
  if (context === undefined) {
    throw new Error("useNEAR must be used within a NearProvider");
  }
  return context;
}
```

### Using in Your App

```typescript
// App.tsx
import { NearProvider } from './context/NearProvider';

function App() {
  return (
    <NearProvider
      network="testnet"
      contractId="your-contract.testnet"
      allowedMethods={["vote", "comment", "like"]}
    >
      <YourApp />
    </NearProvider>
  );
}
```

```typescript
// Component.tsx
import { useNEAR } from './context/NearProvider';

function MyComponent() {
  const { signIn, signOut, createKey, callFunction, signedAccountId } = useNEAR();

  const handleCreateAccessKey = async () => {
    try {
      await createKey();
      alert("Access key created! Future transactions will be seamless.");
    } catch (error) {
      console.error("Error creating access key:", error);
    }
  };

  const handleVote = async () => {
    try {
      // This will use the access key if available (no popup!)
      // Otherwise, it will fall back to wallet popup
      await callFunction(
        "your-contract.testnet",
        "vote",
        { postId: "123" }
      );
      alert("Vote successful!");
    } catch (error) {
      console.error("Error voting:", error);
    }
  };

  return (
    <div>
      {!signedAccountId ? (
        <button onClick={signIn}>Connect Wallet</button>
      ) : (
        <>
          <p>Connected: {signedAccountId}</p>
          <button onClick={handleCreateAccessKey}>
            Enable Seamless Transactions
          </button>
          <button onClick={handleVote}>Vote (No Popup!)</button>
          <button onClick={signOut}>Disconnect</button>
        </>
      )}
    </div>
  );
}
```

## License

MIT

# Function Call Key Plugin

`function-call-key-plugin` is a `@hot-labs/near-connect` wallet plugin that lets you execute eligible function-call transactions with a locally stored key pair, falling back to wallet signing when a transaction does not match the key permissions.

## Installation

```bash
pnpm add function-call-key-plugin
```

Or:

```bash
npm install function-call-key-plugin
```

## Exports

- `createAccessKeyPlugin(params)`

## Quick Start

```ts
import { NearConnector } from "@hot-labs/near-connect";
import { createAccessKeyPlugin } from "function-call-key-plugin";

const connector = new NearConnector({
  network: "testnet",
  // providers: {
  //   mainnet: ["https://free.rpc.fastnear.com"],
  //   testnet: ["https://rpc.testnet.fastnear.com"]
  // }
});

const accessKeyPlugin = createAccessKeyPlugin({
  network: connector.network,
  // providers: connector.providers,
  signIn: {
    contractId,
    methodNames,
    allowance
  }
});

// Register the plugin instance.
await connector.use(accessKeyPlugin);

// The plugin adds the configured function-call key parameters to wallet sign-in.
await connector.connect();
```

When `signIn` is configured, the plugin creates a local key during sign-in and
adds its public key and permissions to the wallet request. The private key is
stored only after sign-in succeeds, together with the returned account ID.

## Local Signing Rules

The plugin will sign a transaction locally only when all conditions are true:

- `tx.receiverId` matches the configured `contractId`
- Every action is a `FunctionCall`
- If `methodNames` is non-empty, each function being called is in the allowed list

If any condition fails, it calls the provided `next()` handler and uses normal
wallet signing. If local signing fails, the plugin also falls back to the
provided `next()` handler.

## Sign-in configuration

```ts
createAccessKeyPlugin({
  network,
  providers,
  signIn: {
    contractId,
    methodNames: [], // Empty allows every method.
    allowance: "250000000000000000000000" // Optional; defaults to 0.25 NEAR.
  }
});
```

## Plugin Methods

### `signAndSendTransaction(params, next)`

Intercepts single transaction signing and attempts local signing when eligible.

### `signAndSendTransactions(params, next)`

For batch calls, signs locally only if every transaction is eligible.

### `signOut(_, next)`

After wallet sign-out succeeds, clears the account-specific keys from local
storage for the accounts that were signed in.

## Storage

Stored in browser `localStorage` at
`access_key::plugin::<network>::<accountId>`:

- `privateKey`
- `contractId`
- `methodNames`

## Security Notes

- Private keys in `localStorage` should be treated as hot keys
- Use limited allowance and method restrictions

## License

MIT

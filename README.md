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

- `createAccessKeyPlugin(provider)`

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
  // providers: connector.providers
});

// Register the plugin instance.
connector.use(accessKeyPlugin);

/// Use the plugin to create an access key on connect,
// this key will be used for signing transactions that match the specified permissions,
await connector.connect({
  addFunctionCallKey: {
    contractId,
    allowMethods: { anyMethod: false, methodNames },
    gasAllowance: { kind: "limited", amount: allowance },
    publicKey: accessKeyPlugin.createLocalKeyFor({ contractId, methodNames, allowance })
  }
});
```

## Local Signing Rules

The plugin will sign a transaction locally only when all conditions are true:

- `tx.receiverId` matches the configured `contractId`
- Every action is a `FunctionCall`
- If `allowedMethods` is non-empty, each function being called is in the allowed list

If any condition fails, it calls the provided `next()` handler and uses normal wallet signing.

## Plugin Methods

### `createLocalKeyFor(params): string`

Creates a random `ed25519` key pair, stores the private key + policy in local storage, and returns the public key string.

Params:

- `contractId: string`
- `methodNames: string[]` - use `[]` to allow all methods
- `allowance: string` -in yoctoNEAR, e.g. `nearToYocto(0.25)` or "0" for unlimited allowance

### `signAndSendTransaction(params, next)`

Intercepts single transaction signing and attempts local signing when eligible.

### `signAndSendTransactions(params, next)`

For batch calls, signs locally only if every transaction is eligible.

### `signOut(_, next)`

Clears `access_key::plugin` from local storage, then calls `next()`.

## Storage

Stored in browser `localStorage` at `access_key::plugin`:

- `privateKey`
- `contractId`
- `allowedMethods`

## Security Notes

- Private keys in `localStorage` should be treated as hot keys
- Use limited allowance and method restrictions

## License

MIT

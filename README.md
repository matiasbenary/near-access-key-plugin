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
    methodNames, // default: [], allows to call all methods
    allowance // default: "250000000000000000000000" (0.25 NEAR)
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
- Every function call has a zero deposit

If any condition fails, it calls the provided `next()` handler and uses normal
wallet signing. If the local key is out of allowance, the wallet handles the
transaction instead. If the key no longer exists on-chain, the plugin also
removes it from local storage before using the wallet. Other local signing
errors are returned to the caller.

For batch calls, transactions completed locally are preserved and only the
failed transaction and the remaining transactions are sent to the wallet.

## License

MIT

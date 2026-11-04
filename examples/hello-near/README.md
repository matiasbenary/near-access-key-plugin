# Hello NEAR local plugin example

Adapted from `near-examples/sources/hello-near-examples/frontend`. This Next.js
frontend calls `hello.near-examples.testnet` using NEAR Connect and the plugin
in this repository. Use Node.js 22.22.2 or newer and pnpm.

From the repository root:

```sh
pnpm install
pnpm --dir examples/hello-near install
pnpm example
```

Open http://localhost:3000/hello-near and connect a funded testnet wallet that
supports adding a function-call key during sign-in. Approve the key for
`set_greeting`. Saving a greeting should then work without another wallet prompt.
The greeting is shared by everyone using the contract.

The `function-call-key-plugin` dependency uses `link:../..`, so it resolves to
the local repository's `dist` directory. `pnpm example` builds the plugin before
starting Next.js. To rebuild automatically while editing the plugin, also run
`pnpm dev` in a second terminal. Refresh the browser after a rebuild if needed.

## Manual checks

- **Local signing:** sign out and sign in again to register a fresh key. Save a
  greeting and confirm it changes without a wallet prompt. The browser's local
  storage should contain `access_key::plugin::testnet::<your-account-id>`.
- **Wallet fallback without a local key:** delete that local-storage entry and
  save another greeting. The wallet should handle signing.
- **Missing on-chain key:** sign in with a fresh key, then revoke its public key
  through your wallet's access-key management while leaving the browser entry
  intact. Save a greeting. The plugin should remove the stale local entry and
  fall back to the wallet. Derive the public key from the stored private key
  locally if your wallet needs it; do not share the private key.
- **Allowance fallback:** temporarily change the allowance in
  `src/providers/near-provider.tsx` to `'1'`, then sign out and sign in again.
  Saving a greeting should fall back to the wallet while retaining the local
  entry. Restore the allowance afterward.
- **Sign-out cleanup:** sign out and confirm the local-storage entry disappears.

For multiple-provider recovery, add a second working testnet RPC URL in
`connectorOptions.providers.testnet` in `src/providers/near-provider.tsx` and
repeat the missing-key and allowance checks.

These are interactive integration checks; they require a wallet and testnet
RPC access. They do not cover partial-batch recovery.

To check the frontend without a wallet:

```sh
pnpm --dir examples/hello-near exec tsc --noEmit
pnpm --dir examples/hello-near lint
pnpm --dir examples/hello-near build
```

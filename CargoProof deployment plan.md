# CargoProof deployment plan

## Architecture

Deploy the frontend to Vercel and the API to Railway. The Railway service exposes the Express/tRPC backend and `/health`; Vercel serves the React frontend and points to Railway through `VITE_API_URL`. The first worker deployment should use a scheduled one-shot run (`pnpm worker:once`) every 1–5 minutes. Keep `pnpm worker:start` for a later persistent-worker decision.

## Railway API service

Create a Railway service from this repository. The included `railway.json` uses `pnpm install --frozen-lockfile && pnpm build`, starts with `pnpm start`, and checks `GET /health`.

Set these Railway variables:

```text
NODE_ENV=production
PORT=3000
DATABASE_URL=<Railway MySQL connection string>
JWT_SECRET=<long random secret>
CORS_ORIGINS=https://<vercel-production-domain>,https://<vercel-preview-domain-if-needed>
SEPOLIA_RPC_URL=<Sepolia RPC URL>
CREDITCOIN_RPC_URL=<Creditcoin testnet RPC URL>
CREDITCOIN_CHAIN_ID=102031
SOURCE_REGISTRY_ADDRESS=<deployed Sepolia registry>
FINANCING_ADDRESS=<deployed Creditcoin financing contract>
ATTESTCOIN_ADAPTER_ADDRESS=<deployed Creditcoin adapter>
PROOF_BUILDER_URL=https://prover.cc3-testnet.creditcoin.network
CREDITCOIN_DEPLOYER_PRIVATE_KEY=<testnet operator key>
WORKER_LENDER_PRIVATE_KEY=<testnet lender key, if different>
BUILT_IN_FORGE_API_URL=<optional notification endpoint>
BUILT_IN_FORGE_API_KEY=<optional notification key>
```

Never put private keys in Vercel variables, `VITE_*` variables, Git, or the browser bundle.

After the first API deployment, verify:

```bash
curl https://<railway-api-domain>/health
```

## Railway worker service or scheduled job

Use a separate Railway service or Railway scheduled execution with the same repository and server-side variables. The command is:

```bash
pnpm worker:once
```

The worker is bounded and idempotent. It scans `WORKER_FROM_BLOCK` through the latest Sepolia block, creates or updates worker events, builds the proof, submits the adapter transaction, and releases the tranche only after acceptance.

Start with a 5-minute schedule. Reduce to 1 minute only after RPC cost, retry volume, and database load are understood. Do not run both cron and persistent mode for the same deployment unless a lock or unique worker ownership mechanism has been added.

## Vercel frontend

Create a Vercel project from the same repository. The included `vercel.json` builds the project and serves `dist/public`.

Set these Vercel variables for Production and Preview as appropriate:

```text
VITE_API_URL=https://<railway-api-domain>
VITE_WALLETCONNECT_PROJECT_ID=<optional WalletConnect project id>
VITE_APP_ID=<optional app id>
```

`VITE_API_URL` is public by design because it points to the API. Do not place server secrets in any `VITE_*` variable.

## Testnet acceptance checklist

1. Open the Vercel preview and connect a testnet wallet.
2. Confirm the sidebar reports the actual wallet network.
3. Create a facility on Creditcoin testnet.
4. Register its shipment on Ethereum Sepolia.
5. Record milestone 1, then refresh shipments.
6. Confirm the API and worker create a `DETECTED` event.
7. Run the scheduled worker once and verify `PROOF_PENDING`.
8. Verify the Attestcoin proof transaction and `PROOF_ACCEPTED`.
9. Verify the Creditcoin release transaction and `RELEASED`.
10. Open transaction detail, copy the hash, and export the receipt/report.
11. Confirm `/health` remains healthy and the retry queue is empty.
12. Test one intentional failure: missing mapping, invalid proof, or duplicate shipment. Confirm the UI shows a real error and the worker records `FAILED` with a retry timestamp.

Do not use production funds or production keys during this testnet acceptance run.

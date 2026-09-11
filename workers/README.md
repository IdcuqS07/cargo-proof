# CargoProof worker operations

`milestone-worker.mjs` is a deterministic event worker. It scans and then listens for `MilestoneRecorded` events from `ShipmentRegistry`, resolves the shipment-to-facility mapping from MySQL, requests an Attestcoin proof, submits it through `AttestcoinAdapter`, and calls `releaseTranche` only after the proof is accepted. It writes event state and retry metadata to `worker_events` and deduplicated alerts to `notifications`.

## Local validation

```bash
WORKER_FROM_BLOCK=11638638 pnpm worker:once
```

The command is bounded and idempotent. Continuous mode is:

```bash
pnpm worker:start
```

## Required server-side secrets

The worker requires `SEPOLIA_RPC_URL`, `CREDITCOIN_RPC_URL`, `CREDITCOIN_DEPLOYER_PRIVATE_KEY`, `DATABASE_URL`, `PROOF_BUILDER_URL` (optional; defaults to the Creditcoin testnet prover), and `BUILT_IN_FORGE_API_URL` plus `BUILT_IN_FORGE_API_KEY` for owner notifications. Use `WORKER_LENDER_PRIVATE_KEY` when the lender is different from the deployer. These variables must be configured as server-side secrets in the eventual always-on runtime; never expose them through `VITE_*` variables or the browser.

## Database mapping

Mappings are managed through the protected tRPC procedures `cargoProof.mappings` and `cargoProof.upsertMapping`. A shipment ID is unique and can point to one active facility. The initial real testnet mapping is stored in `shipment_facility_mappings`; new facilities should be mapped before source milestones are emitted.

## Alerts

A missing mapping or proof failure creates an `ERROR` notification. Three or more unresolved worker events create a deduplicated `WARNING` retry-queue notification. Successful releases create an `INFO` notification. The dashboard polls the protected notifications procedure every 30 seconds and displays the latest alerts in the Live activity panel.

## Production hosting

Reserved Hosting was intentionally not enabled. When approved later, deploy this same project on a single always-on runtime, configure the secrets above server-side, and run `pnpm worker:start` alongside the backend process. The current sandbox command is for validation and is not a durable production service.

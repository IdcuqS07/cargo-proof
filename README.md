# CargoProof

CargoProof is a milestone-based trade-finance dashboard concept for the BUIDL CTC 2026 Fall hackathon. It presents a lender workflow where shipment events from Ethereum Sepolia become verifiable inputs for conditional tranche releases on Creditcoin through Attestcoin.

## Frontend MVP

This repository currently contains the frontend foundation and a functional demo UI based on `CargoProof.md`:

- Overview dashboard with facility metrics and live activity feed.
- Verification pipeline: source event → Attestcoin attestation → Creditcoin proof check → tranche payout.
- Financing facilities table with search, detail inspection, and pause interaction.
- Shipment registry view with milestone timeline.
- Shipment operator console with ordered three-milestone recording flow and source-chain trust boundary.
- Proof operations view with verified, waiting, and failed proof states.
- Create Facility modal for the lender journey using demo testnet data.
- Facility detail modal with source reference copy and downloadable proof receipt JSON.
- Interactive verification simulator with advance-to-payout happy path and invalid-proof failure path.
- Responsive layout with persistent desktop navigation and mobile navigation drawer.

## Smart-contract MVP

The first Solidity contract layer is now included under `contracts/`:

- `ShipmentRegistry.sol` — Ethereum Sepolia source-chain registry with authorized operators, unique shipment/milestone IDs, ordered milestone enforcement, source transaction references, and `ShipmentRegistered`, `MilestoneRecorded`, and `ShipmentDelivered` events.
- `CargoProofFinancing.sol` — Creditcoin financing contract with facility creation, ordered tranches, Attestcoin adapter authorization, proof consumption, replay protection, pause/default/settlement transitions, blocked tranche recording, and the invariant `releasedAmount <= principal`.
- `AttestcoinAdapter.sol` — wrapper around Creditcoin's Verify Precompile at `0x0000000000000000000000000000000000000FD2`; it verifies Merkle/continuity proofs, deduplicates query IDs, and forwards only verified milestones to `CargoProofFinancing`.

Compile both contracts and generate ABI artifacts with:

```bash
pnpm contracts:compile
```

P1 redeployment completed on 13 September 2026. `ShipmentRegistry` is deployed on Ethereum Sepolia at `0xceac99B0CCb3c2418A0b59d751AD3d95E039dc60` (tx `0x514c43c989b10ae5d0aa68b7888e386374acd00ec92b4eb2ee1d8b8b1a3bffc2`). `CargoProofFinancing` is deployed on Creditcoin testnet at `0xE5c9b4a12F7Db2Fa039c6885f36e8F353f4Cac02` (tx `0xcd1514b4a6938d5b448f043beec16b149c7e7bf72ca85b655abdff13630412de`). `AttestcoinAdapter` is deployed at `0xE39da42fED8fCB816f20F0176e1A4c94213c133c` and authorized via `setAttestor` transaction `0x65c3b2cac77522ea808e10f9d03cdb633a74b4fbaafcbfbe21150df039a370bd`.

All values and transactions shown in this frontend are simulated. The UI intentionally distinguishes an on-chain source event, an attested event, a proof verified by Creditcoin ASC, and a payout. CargoProof does not claim to verify the physical world directly; it represents the trust boundary documented in the PRD.

## Worker and on-chain dashboard

`workers/milestone-worker.mjs` listens for `MilestoneRecorded` events, keeps a durable JSON retry state, requests an Attestcoin proof for each mapped shipment, submits the proof through `AttestcoinAdapter`, and calls `releaseTranche` only after the financing contract reports an accepted, unconsumed proof. The worker is idempotent: replayed source events and already-consumed proofs are skipped. Run `pnpm worker:once` for a bounded scan or `pnpm worker:start` for continuous polling. The continuous process must run on an always-on host in production; the current sandbox process is for validation only.

The dashboard overview now performs a read-only call to `CargoProofFinancing.getFacility` on Creditcoin testnet and displays a live snapshot for the deployed real facility. No private key is bundled in the browser; only public RPC and contract addresses are used.

The project is now full-stack capable. The database stores `shipment_facility_mappings`, `worker_events`, and deduplicated `notifications`; protected tRPC procedures expose mapping administration, worker history, and notification reads. The worker reads mappings from the database and sends proof-failure, retry-queue, and release alerts through the server-side notification service. Reserved Hosting was intentionally **not enabled**; the production worker remains ready to run later with server-side secrets via `pnpm worker:start`.

## Project structure

```text
client/
  src/
    pages/Home.tsx       # Dashboard views and demo interactions
    components/ui/        # Scaffolded shadcn/ui primitives
    contexts/             # Theme context
    index.css             # CargoProof design system and responsive styles
    App.tsx               # App shell and providers
  index.html              # Product metadata and fonts
server/                   # Template compatibility placeholder; not part of frontend scope
shared/                   # Template compatibility placeholder
CargoProof.md             # Product Requirements Document
```

## Run locally

```bash
pnpm install
pnpm dev
```

The production checks used for this iteration are:

```bash
pnpm check
pnpm build
```

## Current MVP status

The testnet MVP is now wired to the deployed Sepolia registry, Creditcoin financing contract, Attestcoin adapter, Railway API, MySQL worker index, and bounded retry worker. The browser submits only wallet transactions; proof generation and private-key operations remain server-side.

The source contract is `contracts/ShipmentRegistry.sol`; it is intentionally included in the repository so a clean checkout can compile and reproduce the deployment artifacts. The deployed addresses and transaction hashes are recorded in `deployments/manifest.json` and in the deployment section above.

Run the complete local verification suite with:

```bash
pnpm contracts:compile
pnpm check
pnpm test
pnpm build
```

The contract acceptance tests cover compilation, the source-chain happy path, financing controls, replay protection, ordering, authorization, deadline, pause, and principal-invariant safeguards. The remaining hackathon deliverables are the deck and end-to-end demo video; these are intentionally maintained outside the code task.

## Next engineering steps

Post-MVP work includes event indexing by transaction hash plus log index, a bounded retry-exhausted state, settlement/default controls in the dashboard, batch verification, risk timeline, and production-grade operator authorization.

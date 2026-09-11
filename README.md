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

Deployment completed on 5 September 2026. `ShipmentRegistry` is deployed on Ethereum Sepolia at `0xE3e0b01141860541B7247f0E05b1Ea6cd60556BE` (tx `0xbba98455b91e16948c833cd3d4087ccb279ea613f7eb50fa86de27061bb8e4db`). `CargoProofFinancing` is deployed on Creditcoin testnet at `0xe378E93D5eC4dDa719355c5274d85e97c3a0A500` (tx `0xd4f2af2dfab90039cee87f67b7e775a467960485c1c9b14b0840bae7eb7a2477`). `AttestcoinAdapter` is deployed at `0xaAB31Fb58cf430689A48a5b3d2a632a38Fbb8f05` and authorized via `setAttestor` transaction `0x689135dae381a498daddbd15a30c2a9014d7dcd474074c973e38559e19094863`. A real Sepolia `MilestoneRecorded` proof was accepted by CargoProof in transaction `0xea6a67ad4e44e6c5f972ab374fac9ac056aba69f50ba7614e6576c8ee9713e66`.

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

## Next engineering steps

The next phase should replace the in-memory demo data with the source-chain registry, Creditcoin financing contract, Attestcoin verification adapter, and polling worker defined in the PRD. The frontend should then consume indexed events and transaction receipts without changing the state-machine language shown in the current interface.

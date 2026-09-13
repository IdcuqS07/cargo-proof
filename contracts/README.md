# CargoProof MVP Contracts

This directory contains the Solidity contracts required by the PRD: the Sepolia source registry, the Creditcoin financing contract, and the Attestcoin adapter.

## `ShipmentRegistry.sol`

Deploy this contract to Ethereum Sepolia. The owner can authorize operator accounts. Authorized operators can register shipments and record the ordered milestone sequence: `1 = CargoDeparted`, `2 = HubArrival`, and `3 = Delivered`. The contract emits source-chain events and stores `sourceTxHash`, `sourceLogIndex` is represented by the event log index, and `metadataHash` as a commitment rather than plaintext metadata.

The registry enforces unique shipment and milestone identifiers, authorized operators, source transaction references, and ordered milestones. It records the chain ID at registration time. It does not attest the physical world.

## `CargoProofFinancing.sol`

Deploy this contract to Creditcoin testnet. The deployer starts as admin and attestor. In production, `setAttestor` should authorize the ASC/Attestcoin adapter rather than using an EOA. A lender calls `createFacility` with tranche amounts whose sum cannot exceed principal. The attestor calls `submitAttestedMilestone` only after native Attestcoin verification. The lender/admin then calls `releaseTranche`.

The financing contract enforces ordered tranches, replay protection by milestone ID, proof consumption, facility status guards, deadline guards, total payout <= principal, pause/default/settle transitions, and blocked tranche recording.

P1 adds `expireFacility`, which can be called by anyone after the deadline to move an active or paused facility to `DEFAULTED`. `AttestcoinAdapter.executeVerifiedMilestones` batches independent proof queries while preserving per-query replay protection. Registry operators and adapter submitters are managed independently through `setOperator` and `setSubmitter`, enabling multi-signer operations.

## Compile

```bash
pnpm contracts:compile
```

Artifacts are written to `artifacts/contracts/`. The current testnet deployment is recorded in `../deployments/manifest.json`:

| Contract | Network | Address |
|---|---|---|
| `ShipmentRegistry` | Ethereum Sepolia | `0xE3e0b01141860541B7247f0E05b1Ea6cd60556BE` |
| `CargoProofFinancing` | Creditcoin testnet | `0xe378E93D5eC4dDa719355c5274d85e97c3a0A500` |
| `AttestcoinAdapter` | Creditcoin testnet | `0xaAB31Fb58cf430689A48a5b3d2a632a38Fbb8f05` |

These addresses are testnet-only. Re-deployment requires the RPC URLs and private keys described in `DEPLOYMENT.md`; never use production funds or commit private keys.

The P1 contract functions are present in source and compile-time tested. Because deployed bytecode is immutable, the current addresses above do not contain the P1 additions until a coordinated redeployment and manifest update is performed.

## Deployment order

1. Deploy `ShipmentRegistry` to Ethereum Sepolia.
2. Authorize the logistics operator with `setOperator`.
3. Deploy `CargoProofFinancing` to Creditcoin testnet.
4. Authorize the deployed ASC/Attestcoin adapter with `setAttestor`.
5. Record both addresses and deployment transaction hashes in the deployment manifest and application environment.

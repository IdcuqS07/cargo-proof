# CargoProof MVP Contracts

This directory contains the two Solidity contracts required by the PRD.

## `ShipmentRegistry.sol`

Deploy this contract to Ethereum Sepolia. The owner can authorize operator accounts. Authorized operators can register shipments and record the ordered milestone sequence: `1 = CargoDeparted`, `2 = HubArrival`, and `3 = Delivered`. The contract emits source-chain events and stores `sourceTxHash`, `sourceLogIndex` is represented by the event log index, and `metadataHash` as a commitment rather than plaintext metadata.

The registry enforces unique shipment and milestone identifiers, authorized operators, source transaction references, and ordered milestones. It records the chain ID at registration time. It does not attest the physical world.

## `CargoProofFinancing.sol`

Deploy this contract to Creditcoin testnet. The deployer starts as admin and attestor. In production, `setAttestor` should authorize the ASC/Attestcoin adapter rather than using an EOA. A lender calls `createFacility` with tranche amounts whose sum cannot exceed principal. The attestor calls `submitAttestedMilestone` only after native Attestcoin verification. The lender/admin then calls `releaseTranche`.

The financing contract enforces ordered tranches, replay protection by milestone ID, proof consumption, facility status guards, deadline guards, total payout <= principal, pause/default/settle transitions, and blocked tranche recording.

## Compile

```bash
pnpm contracts:compile
```

Artifacts are written to `artifacts/contracts/`. No deployment has been performed yet; RPC URLs, deployer keys, chain IDs, and the production Attestcoin adapter address are still required.

## Deployment order

1. Deploy `ShipmentRegistry` to Ethereum Sepolia.
2. Authorize the logistics operator with `setOperator`.
3. Deploy `CargoProofFinancing` to Creditcoin testnet.
4. Authorize the production ASC/Attestcoin adapter with `setAttestor`.
5. Record both addresses and deployment transaction hashes in the deployment manifest and application environment.

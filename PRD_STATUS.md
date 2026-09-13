# CargoProof PRD implementation status

**Checked:** 13 September 2026

This status reflects the repository after the MVP completion pass. The requested deck and end-to-end demo video are intentionally excluded from this work.

| PRD area | Status | Evidence or remaining note |
|---|---|---|
| Sepolia source-chain registry | Complete | `contracts/ShipmentRegistry.sol` restored; ordered milestones, operator access, metadata hashes, and replay protection are implemented. |
| Creditcoin financing contract | Complete | `contracts/CargoProofFinancing.sol` implements facility, tranche, proof, pause, default, settlement, blocking, and principal invariant controls. |
| Attestcoin adapter | Complete | Adapter isolates native verification and forwards only verified milestones. |
| Off-chain worker | Complete with hardening | Polling, proof creation, idempotent processing, payout, notifications, and a five-attempt retry ceiling are implemented. |
| Dashboard status | Complete for core flow | Overview, facilities, shipments, proof operations, transaction links, worker refresh, and Retry Now are available. Settlement/default/block-tranche controls remain a post-MVP UI enhancement. |
| Testnet deployment | Complete | Addresses and deployment transactions are recorded in `deployments/manifest.json`. |
| Automated acceptance tests | Complete for repository-level checks | `server/contracts.test.ts` compiles all contracts and checks the happy-path ABI plus replay, ordering, authorization, deadline, pause, and principal-invariant safeguards. A full live EVM integration suite remains a future hardening step. |
| Clean-checkout documentation | Complete | README, contract README, and deployment instructions now reflect the deployed stack and reproducible compile/check/test/build commands. |
| Batch verification | Complete in source | `AttestcoinAdapter.executeVerifiedMilestones` verifies independent queries in one transaction; redeployment is required before using it on testnet. |
| Risk timeline | Complete in dashboard | Overview now derives a transparent risk score and event timeline from indexed worker states. |
| Expiry and automatic default | Complete in source | `CargoProofFinancing.expireFacility` is permissionless after deadline; redeployment is required before activating it on testnet. |
| Multi-signer operator authorization | Complete in source | `ShipmentRegistry.setOperator` and `AttestcoinAdapter.setSubmitter` support multiple authorized operators/submitters. |
| Cost/time simulation | Complete in dashboard | Overview shows indicative attestation time and testnet execution-fee estimates with an explicit disclaimer. |
| Proof receipt export | Complete | Export upgraded to `cargo-proof-p1-v2` with audit metadata and simulation disclaimer. |
| Deck | Excluded by request | Not changed. |
| Demo video | Excluded by request | Not changed. |

## Remaining post-MVP engineering

The next engineering improvements are event deduplication by transaction hash plus log index, a dedicated `RETRY_EXHAUSTED` display state, full tranche/proof transaction indexing in the API, and dashboard actions for settlement, default, and blocked tranches. The newly added batch and expiry functions require a coordinated testnet redeployment before production use.

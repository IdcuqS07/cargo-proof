# AttestcoinAdapter integration

`AttestcoinAdapter.sol` uses the official Creditcoin testnet Native Query Verifier precompile:

```text
0x0000000000000000000000000000000000000FD2
```

Its `executeVerifiedMilestone` flow is:

1. Build the official `MerkleProof` and `ContinuityProof` structs.
2. Call `calculateTxIndex` and derive a replay-protected query ID.
3. Call `verifyAndEmit` on the native verifier precompile.
4. Stop if verification returns false or the query was already processed.
5. Forward the accepted milestone to `CargoProofFinancing.submitAttestedMilestone`.

Before production use, integrate the official EVM decoder library from the Attestcoin examples so that the adapter decodes `encodedTransaction` and checks the expected source event, emitter, shipment ID, milestone type, nonce, and metadata hash. The current wrapper proves transaction inclusion and delegates the business invariant checks to CargoProof; it intentionally does not claim that arbitrary caller-supplied milestone fields were decoded from the transaction.

After deploying the adapter, authorize it on the financing contract:

```solidity
CargoProofFinancing(financingAddress).setAttestor(adapterAddress, true);
```

The adapter owner/submitter should be a worker or controlled relayer, not a public frontend account.

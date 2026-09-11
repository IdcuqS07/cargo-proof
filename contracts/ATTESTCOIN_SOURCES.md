# Official Attestcoin integration sources

- Creditcoin testnet docs: https://docs.creditcoin.org/environments/testnet.md
  - EVM RPC: `https://rpc.cc3-testnet.creditcoin.network`
  - EVM chain ID: `102031`
  - Verify Precompile explorer address: `0x0000000000000000000000000000000000000FD2`
  - Proof generator endpoints: `https://prover.cc3-testnet.creditcoin.network/` and `https://proof-gen-api.cc3-testnet.creditcoin.network/`
  - Official USC SDK: `https://www.npmjs.com/package/@gluwa/usc-sdk`

- Attestcoin readability docs: https://docs.attestcoin.org/attestcoin-protocol/attestcoin-readability.md
  - Flow: wait for source block attestation, request proof generation, submit encoded transaction plus Merkle and continuity proofs to the ASC, call the native Block Prover/Verify Precompile, then decode the verified transaction and apply app logic.

- Official example ASCBase: https://github.com/gluwa/usc-testnet-bridge-examples/blob/main/contracts/sol/USCBase.sol
  - `execute(uint8 action, uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, MerkleProofEntry[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots)`
  - Dedupe query IDs before calling `verifyAndEmit`.

- Official verifier interface: https://github.com/gluwa/usc-testnet-bridge-examples/blob/main/contracts/sol/VerifierInterface.sol
  - `verifyAndEmit(uint64 chainKey, uint64 height, bytes encodedTransaction, MerkleProof merkleProof, ContinuityProof continuityProof) returns (bool)`
  - `calculateTxIndex(MerkleProof merkleProof) returns (uint64)`

- Official decoder package source used by examples: `@gluwa/asc-contracts` `contracts/common/EvmV1Decoder.sol`
  - `decodeReceiptFields(bytes)` returns receipt status and logs.
  - `getLogsByEventSignature(ReceiptFields, bytes32)` filters verified receipt logs by topic-0 signature.
  - `LogEntry` contains emitter address, topics, and data.

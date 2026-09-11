// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

interface INativeQueryVerifier {
    struct MerkleProofEntry { bytes32 hash; bool isLeft; }
    struct MerkleProof { bytes32 root; MerkleProofEntry[] siblings; }
    struct ContinuityProof { bytes32 lowerEndpointDigest; bytes32[] roots; }
    function verifyAndEmit(uint64 chainKey, uint64 height, bytes calldata encodedTransaction, MerkleProof calldata merkleProof, ContinuityProof calldata continuityProof) external returns (bool);
    function calculateTxIndex(MerkleProof calldata merkleProof) external view returns (uint64);
}

interface ICargoProofFinancing {
    function submitAttestedMilestone(bytes32 facilityId, bytes32 milestoneId, uint8 milestoneType, bytes32 proofHash) external;
}

/// @title AttestcoinAdapter
/// @notice Verifies a source-chain transaction with Creditcoin's native Attestcoin precompile,
///         decodes the expected ShipmentRegistry event, then forwards the accepted milestone.
contract AttestcoinAdapter {
    address public constant VERIFY_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;
    bytes32 public constant MILESTONE_RECORDED_SIGNATURE = keccak256("MilestoneRecorded(bytes32,bytes32,uint8,uint256,bytes32,bytes32)");
    address public owner;
    ICargoProofFinancing public immutable financing;
    address public immutable sourceRegistry;
    INativeQueryVerifier public immutable verifier;
    mapping(bytes32 => bool) public processedQueries;
    mapping(address => bool) public submitters;

    error NotOwner();
    error NotSubmitter();
    error InvalidAddress();
    error InvalidProof();
    error InvalidSourceEvent();
    error QueryAlreadyProcessed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlySubmitter() {
        if (!submitters[msg.sender] && msg.sender != owner) revert NotSubmitter();
        _;
    }

    event SubmitterUpdated(address indexed submitter, bool allowed);
    event VerifiedMilestoneForwarded(bytes32 indexed queryId, bytes32 indexed facilityId, bytes32 indexed milestoneId, uint8 milestoneType, bytes32 proofHash);

    constructor(address financingAddress, address sourceRegistryAddress) {
        if (financingAddress == address(0) || sourceRegistryAddress == address(0)) revert InvalidAddress();
        owner = msg.sender;
        financing = ICargoProofFinancing(financingAddress);
        sourceRegistry = sourceRegistryAddress;
        verifier = INativeQueryVerifier(VERIFY_PRECOMPILE);
        submitters[msg.sender] = true;
    }

    function setSubmitter(address submitter, bool allowed) external onlyOwner {
        if (submitter == address(0)) revert InvalidAddress();
        submitters[submitter] = allowed;
        emit SubmitterUpdated(submitter, allowed);
    }

    function executeVerifiedMilestone(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots,
        bytes32 facilityId,
        bytes32 shipmentId,
        bytes32 milestoneId,
        uint8 milestoneType
    ) external onlySubmitter returns (bytes32 queryId) {
        INativeQueryVerifier.MerkleProof memory merkleProof = INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});
        uint64 txIndex = verifier.calculateTxIndex(merkleProof);
        queryId = keccak256(abi.encode(chainKey, blockHeight, txIndex));
        if (processedQueries[queryId]) revert QueryAlreadyProcessed();

        INativeQueryVerifier.ContinuityProof memory continuityProof = INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});
        if (!verifier.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof)) revert InvalidProof();

        (bytes32 decodedShipmentId, bytes32 decodedMilestoneId, uint8 decodedType,,) = _decodeMilestone(encodedTransaction);
        if (decodedShipmentId != shipmentId || decodedMilestoneId != milestoneId || decodedType != milestoneType) revert InvalidSourceEvent();
        processedQueries[queryId] = true;

        bytes32 proofHash = keccak256(abi.encode(queryId, facilityId, shipmentId, milestoneId, milestoneType, keccak256(encodedTransaction)));
        financing.submitAttestedMilestone(facilityId, milestoneId, milestoneType, proofHash);
        emit VerifiedMilestoneForwarded(queryId, facilityId, milestoneId, milestoneType, proofHash);
    }

    function _decodeMilestone(bytes calldata encodedTransaction)
        internal
        view
        returns (bytes32 shipmentId, bytes32 milestoneId, uint8 milestoneType, bytes32 metadataHash, bytes32 sourceTxHash)
    {
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidSourceEvent();
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, MILESTONE_RECORDED_SIGNATURE);
        for (uint256 i = 0; i < logs.length; i++) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            if (log.address_ != sourceRegistry || log.topics.length != 3 || log.data.length != 128) continue;
            shipmentId = log.topics[1];
            milestoneId = log.topics[2];
            (milestoneType,,metadataHash,sourceTxHash) = abi.decode(log.data, (uint8,uint256,bytes32,bytes32));
            return (shipmentId, milestoneId, milestoneType, metadataHash, sourceTxHash);
        }
        revert InvalidSourceEvent();
    }
}

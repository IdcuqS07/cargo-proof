// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ShipmentRegistry
/// @notice Source-chain registry for ordered shipment milestones.
/// @dev This contract records operator attestations; it does not verify the physical world.
contract ShipmentRegistry {
    enum ShipmentStatus { REGISTERED, IN_TRANSIT, DELIVERED, FAILED }

    struct Shipment {
        address borrower;
        address lender;
        bytes32 cargoHash;
        uint256 sourceChainId;
        uint256 createdAt;
        ShipmentStatus status;
        uint8 nextMilestoneType;
        bool exists;
    }

    struct Milestone {
        bytes32 shipmentId;
        uint8 milestoneType;
        uint256 occurredAt;
        bytes32 metadataHash;
        bytes32 sourceTxHash;
        bool exists;
    }

    address public owner;
    mapping(address => bool) public operators;
    mapping(bytes32 => Shipment) private shipments;
    mapping(bytes32 => Milestone) private milestones;
    mapping(bytes32 => bool) public usedMilestoneIds;

    error NotOwner();
    error NotOperator();
    error InvalidId();
    error InvalidAddress();
    error AlreadyRegistered();
    error NotFound();
    error InvalidMilestone();
    error OutOfOrder();
    error ReplayDetected();

    event OperatorUpdated(address indexed account, bool allowed);
    event ShipmentRegistered(bytes32 indexed shipmentId, address indexed borrower, address indexed lender, bytes32 cargoHash);
    event MilestoneRecorded(bytes32 indexed shipmentId, bytes32 indexed milestoneId, uint8 milestoneType, uint256 occurredAt, bytes32 metadataHash, bytes32 sourceTxHash);
    event ShipmentDelivered(bytes32 indexed shipmentId, uint256 deliveredAt);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != owner && !operators[msg.sender]) revert NotOperator();
        _;
    }

    modifier shipmentExists(bytes32 shipmentId) {
        if (!shipments[shipmentId].exists) revert NotFound();
        _;
    }

    constructor() {
        owner = msg.sender;
        operators[msg.sender] = true;
    }

    function setOperator(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        operators[account] = allowed;
        emit OperatorUpdated(account, allowed);
    }

    function registerShipment(bytes32 shipmentId, address borrower, address lender, bytes32 cargoHash) external onlyOperator {
        if (shipmentId == bytes32(0) || cargoHash == bytes32(0)) revert InvalidId();
        if (borrower == address(0) || lender == address(0)) revert InvalidAddress();
        if (shipments[shipmentId].exists) revert AlreadyRegistered();
        shipments[shipmentId] = Shipment({
            borrower: borrower,
            lender: lender,
            cargoHash: cargoHash,
            sourceChainId: block.chainid,
            createdAt: block.timestamp,
            status: ShipmentStatus.REGISTERED,
            nextMilestoneType: 1,
            exists: true
        });
        emit ShipmentRegistered(shipmentId, borrower, lender, cargoHash);
    }

    function recordMilestone(
        bytes32 shipmentId,
        bytes32 milestoneId,
        uint8 milestoneType,
        uint256 occurredAt,
        bytes32 metadataHash,
        bytes32 sourceTxHash
    ) external onlyOperator shipmentExists(shipmentId) {
        Shipment storage shipment = shipments[shipmentId];
        if (milestoneId == bytes32(0) || metadataHash == bytes32(0) || sourceTxHash == bytes32(0) || occurredAt == 0) revert InvalidMilestone();
        if (milestoneType != shipment.nextMilestoneType || milestoneType == 0 || milestoneType > 3) revert OutOfOrder();
        if (usedMilestoneIds[milestoneId] || milestones[milestoneId].exists) revert ReplayDetected();

        milestones[milestoneId] = Milestone({
            shipmentId: shipmentId,
            milestoneType: milestoneType,
            occurredAt: occurredAt,
            metadataHash: metadataHash,
            sourceTxHash: sourceTxHash,
            exists: true
        });
        usedMilestoneIds[milestoneId] = true;
        shipment.nextMilestoneType = milestoneType + 1;
        if (milestoneType == 1) shipment.status = ShipmentStatus.IN_TRANSIT;
        if (milestoneType == 3) {
            shipment.status = ShipmentStatus.DELIVERED;
            emit ShipmentDelivered(shipmentId, occurredAt);
        }
        emit MilestoneRecorded(shipmentId, milestoneId, milestoneType, occurredAt, metadataHash, sourceTxHash);
    }

    function getShipment(bytes32 shipmentId) external view shipmentExists(shipmentId) returns (Shipment memory) {
        return shipments[shipmentId];
    }

    function getMilestone(bytes32 milestoneId) external view returns (Milestone memory) {
        if (!milestones[milestoneId].exists) revert NotFound();
        return milestones[milestoneId];
    }

    function nextMilestoneType(bytes32 shipmentId) external view shipmentExists(shipmentId) returns (uint8) {
        return shipments[shipmentId].nextMilestoneType;
    }
}

/*
Negative-case guarantees covered by the contract:
1. Duplicate shipment IDs revert AlreadyRegistered.
2. Zero IDs, addresses, hashes, or timestamps revert validation errors.
3. Milestones outside the ordered 1 -> 2 -> 3 sequence revert OutOfOrder.
4. Reused milestone IDs revert ReplayDetected.
5. Unauthorized operators revert NotOperator.
*/

// End of source contract.

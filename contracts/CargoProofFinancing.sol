// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CargoProofFinancing
/// @notice Milestone-gated financing agreement for Creditcoin.
/// @dev An authorized Attestcoin adapter/ASC submits only after native proof verification.
contract CargoProofFinancing {
    enum FacilityStatus { ACTIVE, PAUSED, DEFAULTED, SETTLED, CANCELLED }
    enum TrancheStatus { PENDING, RELEASED, BLOCKED, SETTLED }

    struct Facility {
        bytes32 shipmentId;
        address lender;
        address borrower;
        uint256 principal;
        uint256 releasedAmount;
        uint8 trancheCount;
        uint8 nextMilestone;
        uint256 deadline;
        FacilityStatus status;
        bool exists;
    }

    struct Tranche {
        uint256 amount;
        uint8 milestoneType;
        TrancheStatus status;
        bytes32 sourceMilestoneId;
        bytes32 proofHash;
        bytes32 payoutTxHash;
    }

    struct AttestedProof {
        bytes32 facilityId;
        bytes32 milestoneId;
        uint8 milestoneType;
        bytes32 proofHash;
        bool accepted;
        bool consumed;
    }

    address public owner;
    mapping(address => bool) public admins;
    mapping(address => bool) public attestors;
    mapping(bytes32 => Facility) private facilities;
    mapping(bytes32 => Tranche[]) private tranches;
    mapping(bytes32 => AttestedProof) public proofs;
    mapping(bytes32 => bool) public processedMilestones;

    error NotOwner();
    error NotAdmin();
    error NotAttestor();
    error NotAuthorized();
    error InvalidId();
    error InvalidAddress();
    error InvalidPrincipal();
    error InvalidTranches();
    error AlreadyExists();
    error NotFound();
    error InvalidStatus();
    error OutOfOrder();
    error ReplayDetected();
    error InvalidProof();
    error DeadlinePassed();
    error InvariantViolation();
    error NotReadyToSettle();
    error DeadlineNotReached();

    event AdminUpdated(address indexed account, bool allowed);
    event AttestorUpdated(address indexed account, bool allowed);
    event FacilityCreated(bytes32 indexed facilityId, bytes32 indexed shipmentId, address indexed lender, address borrower, uint256 principal, uint8 trancheCount, uint256 deadline);
    event MilestoneSubmitted(bytes32 indexed facilityId, bytes32 indexed milestoneId, uint8 milestoneType, bytes32 proofHash);
    event TrancheReleased(bytes32 indexed facilityId, uint8 indexed trancheIndex, uint256 amount, bytes32 milestoneId, bytes32 proofHash, bytes32 payoutTxHash);
    event FacilityPaused(bytes32 indexed facilityId, address indexed actor);
    event FacilityDefaulted(bytes32 indexed facilityId, address indexed actor);
    event FacilitySettled(bytes32 indexed facilityId, address indexed actor);
    event TrancheBlocked(bytes32 indexed facilityId, uint8 indexed trancheIndex, bytes32 indexed reasonHash);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAdmin() {
        if (!admins[msg.sender] && msg.sender != owner) revert NotAdmin();
        _;
    }

    modifier onlyAttestor() {
        if (!attestors[msg.sender] && !admins[msg.sender] && msg.sender != owner) revert NotAttestor();
        _;
    }

    modifier facilityExists(bytes32 facilityId) {
        if (!facilities[facilityId].exists) revert NotFound();
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        attestors[msg.sender] = true;
    }

    function setAdmin(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        admins[account] = allowed;
        emit AdminUpdated(account, allowed);
    }

    function setAttestor(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        attestors[account] = allowed;
        emit AttestorUpdated(account, allowed);
    }

    function createFacility(
        bytes32 facilityId,
        bytes32 shipmentId,
        address borrower,
        uint256 principal,
        uint256[] calldata trancheAmounts,
        uint256 deadline
    ) external returns (bytes32) {
        if (facilityId == bytes32(0) || shipmentId == bytes32(0)) revert InvalidId();
        if (facilities[facilityId].exists) revert AlreadyExists();
        if (borrower == address(0)) revert InvalidAddress();
        if (principal == 0 || deadline <= block.timestamp) revert InvalidPrincipal();
        if (trancheAmounts.length == 0 || trancheAmounts.length > type(uint8).max) revert InvalidTranches();

        uint256 total;
        for (uint256 i = 0; i < trancheAmounts.length; i++) {
            if (trancheAmounts[i] == 0 || trancheAmounts[i] > principal) revert InvalidTranches();
            total += trancheAmounts[i];
            if (total > principal) revert InvariantViolation();
            tranches[facilityId].push(Tranche({
                amount: trancheAmounts[i],
                milestoneType: uint8(i + 1),
                status: TrancheStatus.PENDING,
                sourceMilestoneId: bytes32(0),
                proofHash: bytes32(0),
                payoutTxHash: bytes32(0)
            }));
        }

        facilities[facilityId] = Facility({
            shipmentId: shipmentId,
            lender: msg.sender,
            borrower: borrower,
            principal: principal,
            releasedAmount: 0,
            trancheCount: uint8(trancheAmounts.length),
            nextMilestone: 1,
            deadline: deadline,
            status: FacilityStatus.ACTIVE,
            exists: true
        });
        emit FacilityCreated(facilityId, shipmentId, msg.sender, borrower, principal, uint8(trancheAmounts.length), deadline);
        return facilityId;
    }

    /// @notice Called only by the ASC/Attestcoin adapter after native verification succeeds.
    function submitAttestedMilestone(
        bytes32 facilityId,
        bytes32 milestoneId,
        uint8 milestoneType,
        bytes32 proofHash
    ) external onlyAttestor facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (facility.status != FacilityStatus.ACTIVE) revert InvalidStatus();
        if (block.timestamp > facility.deadline) revert DeadlinePassed();
        if (milestoneId == bytes32(0) || proofHash == bytes32(0)) revert InvalidProof();
        if (milestoneType != facility.nextMilestone || milestoneType == 0 || milestoneType > facility.trancheCount) revert OutOfOrder();
        if (processedMilestones[milestoneId]) revert ReplayDetected();
        if (proofs[milestoneId].accepted) revert ReplayDetected();

        proofs[milestoneId] = AttestedProof({
            facilityId: facilityId,
            milestoneId: milestoneId,
            milestoneType: milestoneType,
            proofHash: proofHash,
            accepted: true,
            consumed: false
        });
        emit MilestoneSubmitted(facilityId, milestoneId, milestoneType, proofHash);
    }

    function releaseTranche(
        bytes32 facilityId,
        bytes32 milestoneId,
        bytes32 payoutTxHash
    ) external facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (msg.sender != facility.lender && !admins[msg.sender] && msg.sender != owner) revert NotAuthorized();
        if (facility.status != FacilityStatus.ACTIVE) revert InvalidStatus();
        if (payoutTxHash == bytes32(0)) revert InvalidId();

        AttestedProof storage proof = proofs[milestoneId];
        if (!proof.accepted || proof.consumed || proof.facilityId != facilityId) revert InvalidProof();
        if (processedMilestones[milestoneId]) revert ReplayDetected();
        if (proof.milestoneType != facility.nextMilestone) revert OutOfOrder();

        uint8 trancheIndex = proof.milestoneType - 1;
        Tranche storage tranche = tranches[facilityId][trancheIndex];
        if (tranche.status != TrancheStatus.PENDING) revert InvalidStatus();
        if (facility.releasedAmount + tranche.amount > facility.principal) revert InvariantViolation();

        tranche.status = TrancheStatus.RELEASED;
        tranche.sourceMilestoneId = milestoneId;
        tranche.proofHash = proof.proofHash;
        tranche.payoutTxHash = payoutTxHash;
        facility.releasedAmount += tranche.amount;
        facility.nextMilestone += 1;
        proof.consumed = true;
        processedMilestones[milestoneId] = true;

        emit TrancheReleased(facilityId, trancheIndex, tranche.amount, milestoneId, proof.proofHash, payoutTxHash);
    }

    function pauseFacility(bytes32 facilityId) external facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (msg.sender != facility.lender && !admins[msg.sender] && msg.sender != owner) revert NotAuthorized();
        if (facility.status != FacilityStatus.ACTIVE) revert InvalidStatus();
        facility.status = FacilityStatus.PAUSED;
        emit FacilityPaused(facilityId, msg.sender);
    }

    function defaultFacility(bytes32 facilityId) external onlyAdmin facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (facility.status == FacilityStatus.SETTLED || facility.status == FacilityStatus.CANCELLED) revert InvalidStatus();
        facility.status = FacilityStatus.DEFAULTED;
        emit FacilityDefaulted(facilityId, msg.sender);
    }

    /// @notice Anyone may transition an expired active or paused facility to DEFAULTED.
    /// @dev Expiry must not depend on an operator being online.
    function expireFacility(bytes32 facilityId) external facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (facility.status != FacilityStatus.ACTIVE && facility.status != FacilityStatus.PAUSED) revert InvalidStatus();
        if (block.timestamp <= facility.deadline) revert DeadlineNotReached();
        facility.status = FacilityStatus.DEFAULTED;
        emit FacilityDefaulted(facilityId, msg.sender);
    }

    function settleFacility(bytes32 facilityId) external facilityExists(facilityId) {
        Facility storage facility = facilities[facilityId];
        if (msg.sender != facility.lender && !admins[msg.sender] && msg.sender != owner) revert NotAuthorized();
        if (facility.status != FacilityStatus.ACTIVE && facility.status != FacilityStatus.PAUSED) revert InvalidStatus();
        if (facility.nextMilestone <= facility.trancheCount) revert NotReadyToSettle();
        facility.status = FacilityStatus.SETTLED;
        for (uint256 i = 0; i < tranches[facilityId].length; i++) {
            if (tranches[facilityId][i].status == TrancheStatus.RELEASED) tranches[facilityId][i].status = TrancheStatus.SETTLED;
        }
        emit FacilitySettled(facilityId, msg.sender);
    }

    function blockTranche(bytes32 facilityId, uint8 trancheIndex, bytes32 reasonHash) external onlyAdmin facilityExists(facilityId) {
        if (trancheIndex >= tranches[facilityId].length || reasonHash == bytes32(0)) revert InvalidTranches();
        Tranche storage tranche = tranches[facilityId][trancheIndex];
        if (tranche.status != TrancheStatus.PENDING) revert InvalidStatus();
        tranche.status = TrancheStatus.BLOCKED;
        emit TrancheBlocked(facilityId, trancheIndex, reasonHash);
    }

    function getFacility(bytes32 facilityId) external view facilityExists(facilityId) returns (Facility memory) {
        return facilities[facilityId];
    }

    function getTranche(bytes32 facilityId, uint8 trancheIndex) external view facilityExists(facilityId) returns (Tranche memory) {
        if (trancheIndex >= tranches[facilityId].length) revert NotFound();
        return tranches[facilityId][trancheIndex];
    }

    function getTranches(bytes32 facilityId) external view facilityExists(facilityId) returns (Tranche[] memory) {
        return tranches[facilityId];
    }
}

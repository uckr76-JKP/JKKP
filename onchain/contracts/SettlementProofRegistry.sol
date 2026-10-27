// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title SettlementProofRegistry
/// @notice 정산 검증 리포트의 SHA-256 해시값을 기록한다. 원본 데이터는 저장하지 않는다.
///         한 번 기록된 리포트 ID는 덮어쓸 수 없다.
contract SettlementProofRegistry {
    struct Proof {
        bytes32 reportHash;
        uint64 anchoredAt;
        uint64 blockNumber;
        address recorder;
    }

    address public owner;
    mapping(address => bool) public recorders;
    mapping(bytes32 => Proof) private proofs;

    event ProofAnchored(bytes32 indexed reportId, bytes32 reportHash, address indexed recorder, uint256 anchoredAt);
    event RecorderUpdated(address indexed account, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotRecorder();
    error ZeroAddress();
    error InvalidHash();
    error AlreadyAnchored(bytes32 reportId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRecorder() {
        if (!recorders[msg.sender]) revert NotRecorder();
        _;
    }

    constructor() {
        owner = msg.sender;
        recorders[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit RecorderUpdated(msg.sender, true);
    }

    function setRecorder(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        recorders[account] = allowed;
        emit RecorderUpdated(account, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @param reportId keccak256(리포트 ID 문자열), 예: keccak256("VR-2026-10-0001")
    /// @param reportHash 리포트 파일의 SHA-256 해시값
    function anchor(bytes32 reportId, bytes32 reportHash) external onlyRecorder {
        if (reportHash == bytes32(0)) revert InvalidHash();
        if (proofs[reportId].anchoredAt != 0) revert AlreadyAnchored(reportId);

        proofs[reportId] = Proof({
            reportHash: reportHash,
            anchoredAt: uint64(block.timestamp),
            blockNumber: uint64(block.number),
            recorder: msg.sender
        });

        emit ProofAnchored(reportId, reportHash, msg.sender, block.timestamp);
    }

    /// @notice 기록이 없으면 anchoredAt == 0인 빈 구조체를 반환한다.
    function getProof(bytes32 reportId) external view returns (Proof memory) {
        return proofs[reportId];
    }

    function isAnchored(bytes32 reportId) external view returns (bool) {
        return proofs[reportId].anchoredAt != 0;
    }

    /// @notice 기록된 해시와 일치하면 true. 기록이 없으면 false.
    function verify(bytes32 reportId, bytes32 reportHash) external view returns (bool) {
        Proof storage proof = proofs[reportId];
        return proof.anchoredAt != 0 && proof.reportHash == reportHash;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract HashRegistryV2 is Ownable, SelfMulticall {
    using ECDSA for bytes32;

    event SetSigners(bytes32 indexed hashType, address[] signers);

    event RegisteredHash(
        bytes32 indexed hashType,
        bytes32 hash,
        uint256 timestamp
    );

    struct Hash {
        bytes32 value;
        uint256 timestamp;
    }

    mapping(bytes32 => Hash) public hashes;

    mapping(bytes32 => bytes32) public hashTypeToSignersHash;

    /// @param owner_ Owner address
    constructor(address owner_) {
        transferOwnership(owner_);
    }

    /// @notice Called by the owner to set the hash signers
    /// @param hashType Hash representing a hash type
    /// @param signers Hash signers
    function setSigners(
        bytes32 hashType,
        address[] calldata signers
    ) external onlyOwner {
        require(hashType != bytes32(0), "Hash type zero");
        uint256 signersCount = signers.length;
        require(signersCount != 0, "Signers empty");
        for (uint256 ind1 = 0; ind1 < signersCount; ind1++) {
            address signer = signers[ind1];
            require(signer != address(0), "Signer address zero");
            for (uint256 ind2 = ind1 + 1; ind2 < signersCount; ind2++) {
                require(signer != signers[ind2], "Duplicate signer address");
            }
        }
        hashTypeToSignersHash[hashType] = keccak256(abi.encodePacked(signers));
        emit SetSigners(hashType, signers);
    }

    /// @notice Called to register a new hash for a type
    /// @param hashType Hash representing a hash type
    /// @param hash Signed hash
    /// @param timestamp Timestamp when the hash was signed
    /// @param signatures Hash signatures
    function registerHash(
        bytes32 hashType,
        bytes32 hash,
        uint256 timestamp,
        bytes[] calldata signatures
    ) external {
        require(timestamp <= block.timestamp, "Timestamp from future");
        require(
            timestamp > hashes[hashType].timestamp,
            "Timestamp not more recent"
        );
        uint256 signaturesCount = signatures.length;
        require(signaturesCount != 0, "Signatures empty");
        address[] memory signers = new address[](signaturesCount);
        for (uint256 ind = 0; ind < signaturesCount; ind++) {
            signers[ind] = (
                keccak256(abi.encode(hashType, hash, timestamp))
                    .toEthSignedMessageHash()
            ).recover(signatures[ind]);
        }
        require(
            hashTypeToSignersHash[hashType] ==
                keccak256(abi.encodePacked(signers)),
            "Signature mismatch"
        );
        hashes[hashType] = Hash({value: hash, timestamp: timestamp});
        emit RegisteredHash(hashType, hash, timestamp);
    }

    function getHashValue(
        bytes32 hashType
    ) external view returns (bytes32 value) {
        value = hashes[hashType].value;
    }
}

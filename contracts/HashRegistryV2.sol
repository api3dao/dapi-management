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

    constructor(address owner_) {
        transferOwnership(owner_);
    }

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
                keccak256(abi.encodePacked(hashType, hash, timestamp))
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

    // External contracts can already read the hash `(value, timestamp)` by
    // calling `hashes()`. However, this is not ideal because in most cases
    // only the hash value will be needed, but the caller will have to pay the
    // gas cost of reading both the value and timestamp. This function
    // implements an alternative interface that does not suffer from this
    // issue.
    // We do not need this anywhere in this repo because Api3Market inherits
    // HashRegistry. This function is implemented only for potential, future
    // use-cases of this contract.
    function getHashValue(
        bytes32 hashType
    ) external view returns (bytes32 value) {
        value = hashes[hashType].value;
    }
}

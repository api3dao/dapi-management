// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IHashRegistry.sol";

/// @title Contract that allows users to manage hashes by type which have been
/// signed by a set of pre-defined signer accounts
/// @notice This is intented to be a generic hash registry. These hashes must be
/// signed by all the signers of a specific hash type. The signatures are
/// validated and checked at the time a call to register the hash is made.
/// This contract enables uses cases like adding data to merkle tree and then
/// registering the root previously singed by a set of trusted accounts. Other
/// contracts can then use the data sent to them only if a root of the merkle tree
/// has been registered in this contract.
/// @dev This contract inherits SelfMulticall meaning that all external functions
/// can be called via multicall() or tryMulticall(). Hashes are expected to be
/// signed following the ERC-191: Signed Data Standard (version 0x45 (E)).
/// https://eips.ethereum.org/EIPS/eip-191
contract HashRegistry is Ownable, SelfMulticall, IHashRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;
    using ECDSA for bytes32;

    struct Hash {
        bytes32 value;
        uint256 timestamp;
    }

    mapping(bytes32 => Hash) public override hashes;

    mapping(bytes32 => EnumerableSet.AddressSet) private _hashTypeToSigners;

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
    ) external override onlyOwner {
        require(hashType != bytes32(0), "Hash type zero");
        require(signers.length != 0, "Signers empty");
        require(
            _hashTypeToSigners[hashType].length() == 0,
            "Signers already set"
        );
        EnumerableSet.AddressSet storage _signers = _hashTypeToSigners[
            hashType
        ];
        for (uint256 ind = 0; ind < signers.length; ind++) {
            address signer = signers[ind];
            require(signer != address(0), "Signer address zero");
            require(_signers.add(signer), "Duplicate signer address");
        }
        emit SetSigners(hashType, signers);
    }

    /// @notice Called by the owner to add a new signer to the address set
    /// @param hashType Hash representing a hash type
    /// @param signer // Signer address
    function addSigner(
        bytes32 hashType,
        address signer
    ) external override onlyOwner returns (address[] memory signers) {
        require(hashType != bytes32(0), "Hash type zero");
        require(signer != address(0), "Signer address zero");
        EnumerableSet.AddressSet storage _signers = _hashTypeToSigners[
            hashType
        ];
        require(_signers.add(signer), "Duplicate signer address");
        signers = _signers.values();
        emit AddedSigner(hashType, signer, signers);
    }

    /// @notice Called by the owner to remove a signer from the address set
    /// @dev This operation might change the order in the AddressSet and this
    /// must be considered when trying to register a new hash since signatures
    /// are expected to be received in the same order of the signers stored in
    /// the contract
    /// In the case that all signers are removed, subsequent registerHash() calls
    /// will fail until new signers are added
    /// @param hashType Hash representing a hash type
    /// @param signer // Signer address
    function removeSigner(
        bytes32 hashType,
        address signer
    ) external override onlyOwner returns (address[] memory signers) {
        EnumerableSet.AddressSet storage _signers = _hashTypeToSigners[
            hashType
        ];
        require(_signers.remove(signer), "Signer does not exist");
        signers = _signers.values();
        emit RemovedSigner(hashType, signer, signers);
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
    ) external override {
        require(timestamp <= block.timestamp, "Timestamp from future");
        require(
            timestamp > hashes[hashType].timestamp,
            "Timestamp not more recent"
        );
        EnumerableSet.AddressSet storage _signers = _hashTypeToSigners[
            hashType
        ];
        uint256 signersCount = _signers.length();
        require(signersCount != 0, "Signers not set");
        for (uint256 ind = 0; ind < signersCount; ind++) {
            require(
                (
                    keccak256(abi.encode(hashType, hash, timestamp))
                        .toEthSignedMessageHash()
                ).recover(signatures[ind]) == _signers.at(ind),
                "Signature mismatch"
            );
        }
        hashes[hashType] = Hash({value: hash, timestamp: timestamp});
        emit RegisteredHash(hashType, hash, timestamp);
    }

    /// @notice Returns the signers that are required to sign the hash for a type
    /// @param hashType Hash representing a hash type
    function getSigners(
        bytes32 hashType
    ) external view override returns (address[] memory signers) {
        signers = _hashTypeToSigners[hashType].values();
    }

    function getHashValue(
        bytes32 hashType
    ) external view override returns (bytes32 value) {
        value = hashes[hashType].value;
    }
}

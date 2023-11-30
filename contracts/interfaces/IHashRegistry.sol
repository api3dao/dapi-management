// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/utils/interfaces/ISelfMulticall.sol";

interface IHashRegistry is ISelfMulticall {
    event SetSigners(bytes32 indexed hashType, address[] signers);

    event AddedSigner(
        bytes32 indexed hashType,
        address signer,
        address[] signers
    );

    event RemovedSigner(
        bytes32 indexed hashType,
        address signer,
        address[] signers
    );

    event RegisteredHash(
        bytes32 indexed hashType,
        bytes32 hash,
        uint256 timestamp
    );

    function setSigners(bytes32 hashType, address[] calldata signers) external;

    function addSigner(
        bytes32 hashType,
        address signer
    ) external returns (address[] memory signers);

    function removeSigner(
        bytes32 hashType,
        address signer
    ) external returns (address[] memory signers);

    function registerHash(
        bytes32 hashType,
        bytes32 hash,
        uint256 timestamp,
        bytes[] calldata signatures
    ) external;

    function getSigners(
        bytes32 hashType
    ) external view returns (address[] memory signers);

    function getHashValue(
        bytes32 hashType
    ) external view returns (bytes32 value);

    function hashes(
        bytes32 hashType
    ) external view returns (bytes32 value, uint256 timestamp);
}

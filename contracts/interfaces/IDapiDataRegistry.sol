// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/interfaces/IAccessControlRegistryAdminnedWithManager.sol";

interface IDapiDataRegistry is IAccessControlRegistryAdminnedWithManager {
    event RegisteredSignedApiUrl(address indexed airnode, string url);

    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedData);

    event AddedDapi(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint256 heartbeatInterval
    );

    event RemovedDapi(bytes32 indexed dapiName, address sender);

    event UpdatedDapiDataFeedId(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet,
        address sender
    );

    struct UpdateParameters {
        uint256 deviationThresholdInPercentage;
        int224 deviationReference;
        uint256 heartbeatInterval;
    }

    struct DataFeedValue {
        int224 value;
        uint32 timestamp;
    }

    function DAPI_ADDER_ROLE_DESCRIPTION()
        external
        view
        returns (string memory);

    function DAPI_REMOVER_ROLE_DESCRIPTION()
        external
        view
        returns (string memory);

    function dapiAdderRole() external view returns (bytes32);

    function dapiRemoverRole() external view returns (bytes32);

    function hashRegistry() external view returns (address);

    function api3ServerV1() external view returns (address);

    function airnodeToSignedApiUrl(
        address
    ) external view returns (string memory);

    function dataFeeds(bytes32) external view returns (bytes memory);

    function dapiNameToUpdateParameters(
        bytes32
    ) external view returns (uint256, int224, uint256);

    function registerAirnodeSignedApiUrl(
        address airnode,
        string calldata url,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function registerDataFeed(
        bytes calldata dataFeedData
    ) external returns (bytes32 dataFeedId);

    function addDapi(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint256 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function removeDapi(bytes32 dapiName) external;

    function updateDapiDataFeedId(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function dapisCount() external view returns (uint256 count);

    function readDapiWithName(
        bytes32 dapiName
    )
        external
        view
        returns (
            UpdateParameters memory updateParameters,
            DataFeedValue memory dataFeedValue,
            bytes memory dataFeed,
            string[] memory signedApiUrls
        );

    function readDapiWithIndex(
        uint256 index
    )
        external
        view
        returns (
            bytes32 dapiName,
            UpdateParameters memory updateParameters,
            DataFeedValue memory dataFeedValue,
            bytes memory dataFeed,
            string[] memory signedApiUrls
        );
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/interfaces/IAccessControlRegistryAdminnedWithManager.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/utils/interfaces/ISelfMulticall.sol";
import "./IHashRegistry.sol";

interface IDapiDataRegistry is
    ISelfMulticall,
    IAccessControlRegistryAdminnedWithManager
{
    event RegisteredSignedApiUrl(address indexed airnode, string url);

    event UnregisteredSignedApiUrl(address indexed airnode);

    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedData);

    event RegisteredDapi(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval
    );

    event UnregisteredDapi(bytes32 indexed dapiName);

    struct UpdateParameters {
        uint256 deviationThresholdInPercentage;
        int224 deviationReference;
        uint32 heartbeatInterval;
    }

    function HUNDRED_PERCENT() external view returns (uint256);

    function DAPI_MANAGEMENT_HASH_TYPE() external view returns (bytes32);

    function API_INTEGRATION_HASH_TYPE() external view returns (bytes32);

    function REGISTRAR_ROLE_DESCRIPTION() external view returns (string memory);

    function registrarRole() external view returns (bytes32);

    function hashRegistry() external view returns (IHashRegistry);

    function api3ServerV1() external view returns (IApi3ServerV1);

    function airnodeToSignedApiUrl(
        address
    ) external view returns (string memory);

    function dataFeedIdToData(bytes32) external view returns (bytes memory);

    function registerAirnodeSignedApiUrl(
        address airnode,
        string calldata url,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function unregisterAirnodeSignedApiUrl(address airnode) external;

    function registerDataFeed(
        bytes calldata dataFeedData
    ) external returns (bytes32 dataFeedId);

    function registerDapi(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function unregisterDapi(bytes32 dapiName) external;

    function registeredDapisCount() external view returns (uint256 count);

    function readDapis(
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (
            bytes32[] memory dapiNames,
            bytes32[] memory dataFeedIds,
            UpdateParameters[] memory updateParameters,
            bytes[] memory dataFeedDatas,
            string[][] memory signedApiUrls
        );
}

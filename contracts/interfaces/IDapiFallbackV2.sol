// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/utils/interfaces/ISelfMulticall.sol";

interface IDapiFallbackV2 is ISelfMulticall {
    event AddedDapiFallbackManager(address dapiFallbackManager);
    event RemovedDapiFallbackManager(address dapiFallbackManager);

    struct ExecuteDapiFallbackArgs {
        uint256 dapiFallbackManagerInd; // dAPI fallback manager index
        bytes32 dapiName; // Encoded bytes32 dAPI name
        bytes32 dataFeedId; // Identifier for the data feed receiving the update
        bytes32 fallbackRoot; // Root of the Merkle tree representing the dAPI's fallback structure
        bytes32[] fallbackProof; // Merkle proof for validating the fallback parameters
        bytes updateParams; // Encoded parameters necessary for updating the data feed
        bytes32 priceRoot; // Root of the Merkle tree related to the pricing data
        bytes32[] priceProof; // Merkle proof for verifying the updated pricing data
        uint256 duration; // Time period for which the price is calculated
        uint256 price; // Cost of the data feed for a given duration
        address payable sponsorWallet; // Address of the sponsor wallet for funding
    }

    event Withdrawn(
        address indexed recipient,
        uint256 amount,
        uint256 remainingBalance
    );

    event FundedSponsorWallet(
        address indexed sponsorWallet,
        uint256 amount,
        uint256 remainingBalance,
        address sender
    );

    event ExecutedDapiFallback(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sender
    );

    event RevertedDapiFallback(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet
    );

    function api3ServerV1() external view returns (address);

    function hashRegistry() external view returns (address);

    function dapiDataRegistry() external view returns (address);

    function addDapiFallbackManager(address dapiFallbackManager) external;

    function removeDapiFallbackManager(address dapiFallbackManager) external;

    function withdraw(address payable recipient, uint256 amount) external;

    function withdrawAll(address payable recipient) external;

    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external;

    function revertDapiFallback(
        uint256 dapiFallbackManagerInd,
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    function getFallbackedDapis()
        external
        view
        returns (bytes32[] memory dapis);

    function getDapiFallbackManagers() external view returns (address[] memory);
}

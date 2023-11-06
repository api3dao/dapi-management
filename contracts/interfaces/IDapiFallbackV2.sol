// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/interfaces/IAccessControlRegistryAdminnedWithManager.sol";

/// @title IDapiFallbackV2 - Interface defining the contract for dAPI's fallback mechanisms.
/// @notice This interface declares the events and functions required to manage and execute dAPI fallbacks.
interface IDapiFallbackV2 is IAccessControlRegistryAdminnedWithManager {
    /// @notice Defines the arguments required to execute a dAPI fallback.
    /// These arguments include various parameters and Merkle proofs necessary for the fallback process.
    struct ExecuteDapiFallbackArgs {
        bytes32 dapiName; /// Unique identifier for the dAPI.
        bytes32 dataFeedId; /// Identifier for the data feed receiving the update.
        bytes32 fallbackRoot; /// Root of the Merkle tree representing the dAPI's fallback structure.
        bytes32[] fallbackProof; /// Merkle proof for validating the fallback parameters.
        bytes updateParams; /// Encoded parameters necessary for updating the data feed.
        bytes32 priceRoot; /// Root of the Merkle tree related to the pricing data.
        bytes32[] priceProof; /// Merkle proof for verifying the updated pricing data.
        uint256 duration; /// Time period for which the price is calculated.
        uint256 price; /// Cost of the data feed for a given duration.
        address payable sponsorWallet; /// Address of the sponsor wallet for funding.
    }

    /// @notice Event emitted when funds are successfully withdrawn.
    /// @param recipient Address receiving the funds.
    /// @param amount Amount of funds withdrawn.
    /// @param remainingBalance Remaining balance after the withdrawal.
    event Withdrawn(
        address indexed recipient,
        uint256 amount,
        uint256 remainingBalance
    );

    /// @notice Event emitted when a sponsor wallet is successfully funded.
    /// @param sponsorWallet Address of the sponsor wallet that was funded.
    /// @param amount Amount of funds added.
    /// @param remainingBalance Remaining balance after funding.
    /// @param sender Address of the party that initiated the funding.
    event FundedSponsorWallet(
        address indexed sponsorWallet,
        uint256 amount,
        uint256 remainingBalance,
        address sender
    );

    /// @notice Event emitted when a dAPI fallback has been executed.
    /// @param dapiName The unique identifier for the dAPI involved.
    /// @param dataFeedId Identifier for the data feed that was updated.
    /// @param sender Address of the party that initiated the fallback execution.
    event ExecutedDapiFallback(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sender
    );

    /// @notice Event emitted when a dAPI fallback has been reverted.
    /// @param dapiName The unique identifier for the dAPI involved.
    /// @param dataFeedId Identifier for the data feed that was updated.
    /// @param sponsorWallet Address of the account used to perform data feed
    /// updates.
    event RevertedDapiFallback(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet
    );

    function FALLBACK_EXECUTER_ROLE_DESCRIPTION()
        external
        view
        returns (string memory);

    function FALLBACK_REVERTER_ROLE_DESCRIPTION()
        external
        view
        returns (string memory);

    function fallbackExecuterRole() external view returns (bytes32);

    function fallbackReverterRole() external view returns (bytes32);

    /// @notice Returns the address of the Api3ServerV1 contract.
    function api3ServerV1() external view returns (address);

    /// @notice Returns the address of the HashRegistry contract.
    function hashRegistry() external view returns (address);

    /// @notice Returns the address of the DapiDataRegistry contract.
    function dapiDataRegistry() external view returns (address);

    /// @notice Allows the contract owner to withdraw funds from the contract.
    /// @param amount The amount of funds to withdraw.
    /// @dev This function should emit the Withdrawn event after a successful withdrawal.
    function withdraw(uint256 amount) external;

    /// @notice Executes the dAPI fallback mechanism.
    /// @param args Structured data representing the fallback execution requirements.
    /// @dev This function should emit the ExecutedDapiFallback event upon successful execution.
    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external;

    /// @notice Reverts the dAPI fallback execution mechanism.
    /// @param dapiName dAPI name
    /// @param dataFeedId Data feed ID the dAPI will point to
    /// @param sponsorWallet Sponsor wallet address used to trigger updates
    /// @param deviationThresholdInPercentage Value used to determine if data
    /// feed requires updating based on deviation against API value
    /// @param deviationReference Reference value that deviation will be
    /// calculated against
    /// @param heartbeatInterval Value used to determine if data
    /// feed requires updating based on time elapsed since last update
    /// @param root dAPI Management Merkle tree root hash
    /// @param proof Array of hashes to verify a Merkle tree leaf
    /// @dev This function should emit the RevertedDapiFallback event upon
    /// successful execution and requires the caller to be the contract owner.
    function revertDapiFallback(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external;

    /// @notice Returns the list of dAPIs for which fallback mechanism has been
    /// exectued.
    function getFallbackedDapis()
        external
        view
        returns (bytes32[] memory dapis);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";
import "./interfaces/IDapiDataRegistry.sol";

/// @title DapiFallbackV2 contract for handling dAPI fallbacks in case of primary data feed failure.
/// @notice This contract contains the logic for executing dAPI fallbacks
/// and ensuring data feed continuity by utilizing Merkle proofs for verification.
contract DapiFallbackV2 is
    AccessControlRegistryAdminnedWithManager,
    IDapiFallbackV2
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Fallback executer role description
    string public constant override FALLBACK_EXECUTER_ROLE_DESCRIPTION =
        "Fallback executer";
    /// @notice Fallback reverter role description
    string public constant override FALLBACK_REVERTER_ROLE_DESCRIPTION =
        "Fallback reverter";

    /// @notice Fallback executer role
    bytes32 public immutable override fallbackExecuterRole;
    /// @notice Fallback reverter role
    bytes32 public immutable override fallbackReverterRole;
    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;
    /// @notice HashRegistry contract address
    address public immutable override hashRegistry;
    /// @notice DapiDataRegistry contract address
    address public immutable override dapiDataRegistry;

    /// @notice Constants defining types of the Merkle tree roots used within the contract logic.
    bytes32 private constant DAPI_FALLBACK_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI fallback Merkle tree root"));
    bytes32 private constant DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI pricing Merkle tree root"));
    bytes32 private constant HASHED_PARAMS =
        keccak256(abi.encode(uint256(1e6), int224(0), uint32(1 days)));

    EnumerableSet.Bytes32Set private fallbackedDapis;

    /// @notice Initializes the contract setting the api3ServerV1 and hashRegistry addresses.
    /// @param _accessControlRegistry AccessControlRegistry contract address
    /// @param _adminRoleDescription Admin role description
    /// @param _manager Manager address
    /// @param _api3ServerV1 The address of the Api3ServerV1 contract.
    /// @param _hashRegistry The address of the HashRegistry contract.
    /// @param _dapiDataRegistry The address of the DapiDataRegistry contract.
    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3ServerV1,
        address _hashRegistry,
        address _dapiDataRegistry
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        require(
            _api3ServerV1 != address(0),
            "api3ServerV1 Address cannot be zero"
        );
        require(
            _hashRegistry != address(0),
            "hashRegistry Address cannot be zero"
        );
        require(
            _hashRegistry != address(0),
            "hashRegistry Address cannot be zero"
        );
        require(
            _dapiDataRegistry != address(0),
            "dapiDataRegistry Address cannot be zero"
        );
        fallbackExecuterRole = _deriveRole(
            _deriveAdminRole(manager),
            FALLBACK_EXECUTER_ROLE_DESCRIPTION
        );
        fallbackReverterRole = _deriveRole(
            _deriveAdminRole(manager),
            FALLBACK_REVERTER_ROLE_DESCRIPTION
        );
        api3ServerV1 = _api3ServerV1;
        hashRegistry = _hashRegistry;
        dapiDataRegistry = _dapiDataRegistry;
    }

    /// @notice Allows the contract to receive funds.
    /// @dev The receive function is executed on a call to the contract with empty calldata.
    receive() external payable {}

    /// @notice Allows the contract manager to withdraw funds from the contract.
    /// @param amount The amount of funds to withdraw.
    function withdraw(uint256 amount) external override {
        require(msg.sender == manager, "Sender is not manager role");
        require(amount != 0, "Amount zero");
        Address.sendValue(payable(msg.sender), amount);
        emit Withdrawn(msg.sender, amount, address(this).balance);
    }

    /// @notice Executes the dAPI fallback mechanism for data feed updates by using Merkle proofs
    /// for verification. This function updates a dAPI's data feed if the provided proofs are valid.
    /// @dev The function requires that, the new data feed ID is different from the current one,
    /// the Merkle proofs for dAPI fallback parameters and price updates are valid,
    /// the sponsor wallet's balance meets the minimum requirement; otherwise, the contract funds it.
    /// After validations, it triggers the data feed update on the Api3Server.
    /// @param args A structured parameter of type `ExecuteDapiFallbackArgs`
    /// containing the necessary parameters for the dAPI fallback execution, including:
    ///   - `dapiName`: Identifier of the dAPI.
    ///   - `dataFeedId`: New data feed ID for the dAPI.
    ///   - `fallbackRoot`: Root of the Merkle tree for the dAPI fallback mechanism.
    ///   - `fallbackProof`: Merkle proof for validating the dAPI fallback parameters.
    ///   - `updateParams`: Encoded parameters for the data update.
    ///   - `priceRoot`: Root of the Merkle tree for the pricing data.
    ///   - `priceProof`: Merkle proof for validating the pricing data.
    ///   - `duration`: Time period for which the price is calculated.
    ///   - `price`: Cost of the data feed for a given duration.
    ///   - `sponsorWallet`: Address of the sponsor wallet,
    /// which is funded if the balance is below the required minimum.
    function executeDapiFallback(
        ExecuteDapiFallbackArgs calldata args
    ) external override {
        require(
            msg.sender == manager ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    fallbackExecuterRole,
                    msg.sender
                ),
            "Sender is not manager or has fallback executer role"
        );
        require(args.dapiName != bytes32(0), "Dapi name is zero");
        require(args.dataFeedId != bytes32(0), "Data feed ID is zero");
        require(args.updateParams.length != 0, "Update params empty");
        require(args.duration != 0, "Duration is zero");
        require(args.price != 0, "Price is zero");
        require(args.sponsorWallet != address(0), "Zero address");

        bytes32 hashedUpdateParams = keccak256(args.updateParams);

        require(
            hashedUpdateParams == HASHED_PARAMS,
            "Update params does not match"
        );

        bytes32 currentDataFeedId = IApi3ServerV1(api3ServerV1)
            .dapiNameHashToDataFeedId(args.dapiName);
        require(
            currentDataFeedId != args.dataFeedId,
            "Data feed ID will not be changed"
        );

        bytes32 fallbackLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        args.dapiName,
                        args.dataFeedId,
                        args.sponsorWallet
                    )
                )
            )
        );
        _validateTree(
            DAPI_FALLBACK_MERKLE_TREE_ROOT_HASH_TYPE,
            args.fallbackProof,
            args.fallbackRoot,
            fallbackLeaf
        );

        bytes32 priceLeaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        args.dapiName,
                        block.chainid,
                        args.updateParams,
                        args.duration,
                        args.price
                    )
                )
            )
        );

        _validateTree(
            DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE,
            args.priceProof,
            args.priceRoot,
            priceLeaf
        );

        IApi3ServerV1(api3ServerV1).setDapiName(args.dapiName, args.dataFeedId);

        require(
            fallbackedDapis.add(args.dapiName),
            "dAPI fallback already executed"
        );

        IDapiDataRegistry(dapiDataRegistry).removeDapi(args.dapiName);

        uint256 minSponsorWalletBalance = (args.price * 1 days) / args.duration;

        uint256 sponsorWalletBalance = args.sponsorWallet.balance;
        if (sponsorWalletBalance < minSponsorWalletBalance) {
            uint256 amount = minSponsorWalletBalance - sponsorWalletBalance;
            Address.sendValue(args.sponsorWallet, amount);
            emit FundedSponsorWallet(
                args.sponsorWallet,
                amount,
                address(this).balance,
                msg.sender
            );
        }

        emit ExecutedDapiFallback(args.dapiName, args.dataFeedId, msg.sender);
    }

    /// @notice Reverts the dAPI fallback execution by setting the dAPI back to a
    /// managed data feed. It uses Merkle tree root and proof for verification
    /// and it also requires that the executeDapiFallback function was previously
    /// called
    /// @dev Only the fallback reverter or manager can execute this function to switch back to
    /// managed data feed
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
    function revertDapiFallback(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external override {
        require(
            msg.sender == manager ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    fallbackReverterRole,
                    msg.sender
                ),
            "Sender is not manager or has fallback reverter role"
        );
        require(
            fallbackedDapis.remove(dapiName),
            "dAPI fallback has not been executed"
        );
        IDapiDataRegistry(dapiDataRegistry).addDapi(
            dapiName,
            dataFeedId,
            sponsorWallet,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval,
            root,
            proof
        );
        emit RevertedDapiFallback(dapiName, dataFeedId, sponsorWallet);
    }

    /// @notice Returns the dAPIs for which fallback has been executed
    /// @dev Fallback data feeds are single sourced and self funded data feeds
    /// with deviation threshold of 1% and heartbeat interval of 1 day (in secs).
    /// These data feeds are managed by Nodary.io so any other addtional
    /// information like beaconId or sponsor wallet can be read by off-chain apps
    /// straigth from the website/API or use the Merkle tree JSON file exported
    /// by the api3/dapi-management repo
    function getFallbackedDapis()
        external
        view
        override
        returns (bytes32[] memory dapis)
    {
        dapis = fallbackedDapis.values();
    }

    /// @notice Validates the Merkle tree structure by verifying its root and proofs.
    /// @param treeType The type of the tree, denoted by its specific hash type.
    /// @param proof Proofs for the Merkle tree leaves.
    /// @param root The known root of the Merkle tree.
    /// @param leaf The specific leaf node of the Merkle tree being validated.
    function _validateTree(
        bytes32 treeType,
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) private view {
        require(proof.length != 0, "Proof is empty");
        require(root != bytes32(0), "Root is zero");
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(treeType) == root,
            "Tree has not been registered"
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid tree proof");
    }
}

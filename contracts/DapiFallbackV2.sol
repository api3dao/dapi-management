// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";
import "./interfaces/IDapiDataRegistry.sol";

/// @title DapiFallbackV2 contract for handling dAPI fallbacks in case of primary data feed failure.
/// @notice This contract contains the logic for executing dAPI fallbacks
/// and ensuring data feed continuity by utilizing Merkle proofs for verification.
/// @dev The contract inherits from the Ownable contract of the OpenZeppelin library
/// @dev which provides basic authorization control functions.
contract DapiFallbackV2 is Ownable, IDapiFallbackV2 {
    using EnumerableSet for EnumerableSet.Bytes32Set;

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
    /// @param _api3ServerV1 The address of the Api3ServerV1 contract.
    /// @param _hashRegistry The address of the HashRegistry contract.
    /// @param _dapiDataRegistry The address of the DapiDataRegistry contract.
    /// @dev The constructor requires non-zero addresses for the api3ServerV1 and hashRegistry contracts.
    constructor(
        address _api3ServerV1,
        address _hashRegistry,
        address _dapiDataRegistry
    ) {
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
        api3ServerV1 = _api3ServerV1;
        hashRegistry = _hashRegistry;
        dapiDataRegistry = _dapiDataRegistry;
    }

    /// @notice Allows the contract to receive funds.
    /// @dev The receive function is executed on a call to the contract with empty calldata.
    receive() external payable {}

    /// @notice Allows the contract owner to withdraw funds from the contract.
    /// @param amount The amount of funds to withdraw.
    function withdraw(uint256 amount) external override onlyOwner {
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

        require(
            fallbackedDapis.add(args.dapiName),
            "dAPI fallback already executed"
        );

        IDapiDataRegistry(dapiDataRegistry).removeDapi(args.dapiName);

        emit ExecutedDapiFallback(args.dapiName, args.dataFeedId, msg.sender);
    }

    // This function requires the root and a proof from the dAPI management
    // Merkle tree and that the fallback dAPI function was previously executed.
    // TODO: Only the contract owner can execute this function to switch back to
    // previous payed dAPI subscription. Why anyone can call executeDapiFallback?
    // We used to have a onlyByDapiFallbackExecutorWithInd modifier to have only
    // a group of people be able to execute this function. I know that data from
    // merkle trees has been reviewed and signed by other people but anyone that
    // gets a hold of the json files with the merkle trees or by just clicking on
    // the dapi management UI can still switch to fallback at any given time?
    function revertDapiFallback(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external override onlyOwner {
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
    function getFallbackedDapis()
        external
        view
        override
        returns (bytes32[] memory dapis)
    {
        dapis = fallbackedDapis.values();

        // TODO: This function is intended to be used by the UI to still be able to display fallbacked dAPIs
        //       Should we store the dataFeedId and sponsorWallet used on executeDapiFallback? update params
        //       are fixed at 1% deviation and 1 day heartbeat so might not be needed to be stored on-chain
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

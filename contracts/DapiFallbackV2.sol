// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "./interfaces/IHashRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";
import "./interfaces/IDapiDataRegistry.sol";

/// @title Contract that sets dAPI names to fallback data feeds under specific
/// conditions
/// @notice The objective of this contract is to enable individual "dAPI
/// fallback admins" to be able to execute a pre-planned response plan for
/// dAPI emergencies. The plan is to redirect the dAPI from a more
/// decentralized data feed that will not be able to respond to emergencies
/// swiftly to a data feed that we can reasonably expect to not be affected by
/// the factors that cause the emergency or at least quickly address these.
/// The conditions to be able to execute the plan are as follow:
/// - The sender must be a dAPI fallback admin
/// - The respective fallback data feed must have been included in a Merkle
/// tree whose root has been signed by all "root signers" and registered on the
/// HashRegsitry contract.
/// - The dAPI must have already been pointing to a data feed that is not the
/// fallback data feed
/// - Have enought funds to be able to top-up the data feed sponsor wallet for at
/// least a day on the current chain according to the prices from the merkle tree
/// - The fallback data feed must have been updated in the last day
/// In addition to executing fallbacks, the dAPI fallback admins are allowed
/// to transfer funds from this contract to the sponsor wallets of the fallback
/// data feeds (because both the fallback data feeds being operational and
/// their sponsor wallets being funded are required for fallbacks to be
/// executed). These admins can also undo the fallback execution by setting the
/// dAPI back to a decentralized data feed.
/// @dev This contract needs to be granted the dAPI name setter role by the
/// manager of the respective Api3ServerV1 contract to be able to execute
/// fallbacks. It also require the dAPI adder and dAPI remover roles from the
/// DapiDataRegistry contract as well
contract DapiFallbackV2 is Ownable, SelfMulticall, IDapiFallbackV2 {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;
    /// @notice HashRegistry contract address
    address public immutable override hashRegistry;
    /// @notice DapiDataRegistry contract address
    address public immutable override dapiDataRegistry;

    bytes32 private constant DAPI_FALLBACK_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI fallback Merkle tree root"));
    bytes32 private constant DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI pricing Merkle tree root"));
    uint256 private constant HUNDRED_PERCENT = 1e8;
    bytes32 private constant HASHED_FALLBACK_UPDATE_PARAMS =
        keccak256(
            abi.encode(
                uint256(HUNDRED_PERCENT / 100),
                int224(0),
                uint256(1 days)
            )
        );

    /// @notice dAPI fallback admins that can individually execute the
    /// response plan
    EnumerableSet.AddressSet private _dapiFallbackAdmins;

    EnumerableSet.Bytes32Set private _revertableDapiFallbacks;

    /// @dev Reverts unless the sender is the dAPI fallback admin with the
    /// specified index
    /// @param dapiFallbackAdminInd dAPI fallback admin index
    modifier onlyDapiFallbackAdminWithInd(uint256 dapiFallbackAdminInd) {
        require(
            msg.sender == _dapiFallbackAdmins.at(dapiFallbackAdminInd) ||
                msg.sender == address(0),
            "Sender not admin with ID"
        );
        _;
    }

    /// @param _api3ServerV1 Api3ServerV1 contract address
    /// @param _hashRegistry HashRegistry contract address
    /// @param _dapiDataRegistry DapiDataRegistry contract address
    constructor(
        address _api3ServerV1,
        address _hashRegistry,
        address _dapiDataRegistry
    ) {
        require(_api3ServerV1 != address(0), "Api3ServerV1 address zero");
        require(_hashRegistry != address(0), "HashRegistry address zero");
        require(
            _dapiDataRegistry != address(0),
            "DapiDataRegistry address zero"
        );
        api3ServerV1 = _api3ServerV1;
        hashRegistry = _hashRegistry;
        dapiDataRegistry = _dapiDataRegistry;
    }

    /// @notice Allows the contract to receive funds. These funds can then be
    /// transferred to the sponsor wallets of the fallback data feeds by a dAPI
    /// fallback admin or withdrawn by the owner
    /// @dev The receive function is executed on a call to the contract with
    /// empty calldata
    receive() external payable {}

    /// @notice Called by the owner to initialize the dAPI fallback admins
    /// @param dapiFallbackAdmins dAPI fallback admins
    function setUpDapiFallbackAdmins(
        address[] calldata dapiFallbackAdmins
    ) external override onlyOwner {
        require(dapiFallbackAdmins.length != 0, "Admins empty");
        require(
            _dapiFallbackAdmins.length() == 0,
            "Admins already initialized"
        );
        for (uint256 ind = 0; ind < dapiFallbackAdmins.length; ind++) {
            address dapiFallbackAdmin = dapiFallbackAdmins[ind];
            require(dapiFallbackAdmin != address(0), "Admin address zero");
            require(
                _dapiFallbackAdmins.add(dapiFallbackAdmin),
                "Duplicate admin address"
            );
        }
        emit SetUpDapiFallbackAdmins(dapiFallbackAdmins);
    }

    /// @notice Called by the owner to add a dAPI fallback admin
    /// @param dapiFallbackAdmin dAPI fallback admin address
    function addDapiFallbackAdmin(
        address dapiFallbackAdmin
    ) public override onlyOwner returns (address[] memory dapiFallbackAdmins) {
        require(dapiFallbackAdmin != address(0), "Admin address zero");
        require(
            _dapiFallbackAdmins.add(dapiFallbackAdmin),
            "Duplicate admin address"
        );
        dapiFallbackAdmins = _dapiFallbackAdmins.values();
        emit AddedDapiFallbackAdmin(dapiFallbackAdmin);
    }

    /// @notice Called by the owner to remove a dAPI fallback admin
    /// @dev This operation might change the order in the AddressSet and this
    /// must be considered when calling functions that require an index to be
    /// passed as argument (i.e. executeDapiFallback() or any other function
    /// using the onlyDapiFallbackAdminWithInd modifier)
    /// @param dapiFallbackAdmin dAPI fallback admin address
    function removeDapiFallbackAdmin(
        address dapiFallbackAdmin
    )
        external
        override
        onlyOwner
        returns (address[] memory dapiFallbackAdmins)
    {
        require(dapiFallbackAdmin != address(0), "Admin address zero");
        require(
            _dapiFallbackAdmins.remove(dapiFallbackAdmin),
            "Admin does not exist"
        );
        dapiFallbackAdmins = _dapiFallbackAdmins.values();
        emit RemovedDapiFallbackAdmin(dapiFallbackAdmin);
    }

    /// @notice Called by the owner to withdraw funds
    /// @param recipient Recipient address
    /// @param amount Amount
    function withdraw(
        address payable recipient,
        uint256 amount
    ) external override onlyOwner {
        _withdraw(recipient, amount);
    }

    /// @notice Called by the owner to withdraw the entire balance
    /// @param recipient Recipient address
    function withdrawAll(
        address payable recipient
    ) external override onlyOwner {
        _withdraw(recipient, address(this).balance);
    }

    /// @notice Executes the dAPI fallback mechanism for data feed updates by using Merkle proofs
    /// for verification. This function updates a dAPI's data feed if the provided proofs are valid.
    /// @dev The function requires that, the new data feed ID is different from the current one,
    /// the Merkle proofs for dAPI fallback parameters and price updates are valid,
    /// the sponsor wallet's balance meets the minimum requirement; otherwise, the contract funds it.
    /// After validations, it triggers the data feed update on the Api3Server.
    /// @param args A structured parameter of type `ExecuteDapiFallbackArgs`
    /// containing the necessary parameters for the dAPI fallback execution, including:
    ///   - `dapiFallbackAdminInd`: Index of the manager in the _dapiFallbackAdmins array
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
    )
        external
        override
        onlyDapiFallbackAdminWithInd(args.dapiFallbackAdminInd)
    {
        require(args.dapiName != bytes32(0), "dAPI name zero");
        require(args.dataFeedId != bytes32(0), "Data feed ID zero");
        require(args.duration != 0, "Duration zero");
        require(args.price != 0, "Price zero");
        require(
            args.sponsorWallet != address(0),
            "Sponsor wallet address zero"
        );
        require(
            keccak256(args.updateParams) == HASHED_FALLBACK_UPDATE_PARAMS,
            "Invalid update parameters"
        );
        require(
            IApi3ServerV1(api3ServerV1).dapiNameToDataFeedId(args.dapiName) !=
                args.dataFeedId,
            "Data feed ID will not change"
        );

        _validateTree(
            DAPI_FALLBACK_MERKLE_TREE_ROOT_HASH_TYPE,
            args.fallbackProof,
            args.fallbackRoot,
            keccak256(
                bytes.concat(
                    keccak256(
                        abi.encode(
                            args.dapiName,
                            args.dataFeedId,
                            args.sponsorWallet
                        )
                    )
                )
            )
        );

        _validateTree(
            DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE,
            args.priceProof,
            args.priceRoot,
            keccak256(
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
            )
        );

        (, uint32 timestamp) = IApi3ServerV1(api3ServerV1).readDataFeedWithId(
            args.dataFeedId
        );
        // Data feed must have been updated in the last day, assuming that the
        // largest heartbeat interval is 1 day
        require(timestamp + 1 days > block.timestamp, "Fallback feed stale");

        IApi3ServerV1(api3ServerV1).setDapiName(args.dapiName, args.dataFeedId);

        require(
            _revertableDapiFallbacks.add(args.dapiName),
            "Fallback already executed"
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
    /// @dev Only the fallback admin with ID can execute this function to switch back to
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
        uint256 dapiFallbackAdminInd,
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external override onlyDapiFallbackAdminWithInd(dapiFallbackAdminInd) {
        require(
            _revertableDapiFallbacks.remove(dapiName),
            "Fallback not revertable"
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

    /// @notice Returns the dAPI fallback admins
    /// @return dapiFallbackAdmins dAPI fallback admins
    function getDapiFallbackAdmins()
        external
        view
        override
        returns (address[] memory dapiFallbackAdmins)
    {
        dapiFallbackAdmins = _dapiFallbackAdmins.values();
    }

    /// @notice Returns the dAPIs for which fallback has been executed
    /// @dev Fallback data feeds are single sourced and self funded data feeds
    /// with deviation threshold of 1% and heartbeat interval of 1 day (in secs).
    /// These data feeds are managed by Nodary.io so any other addtional
    /// information like beaconId or sponsor wallet can be read by off-chain apps
    /// straigth from the website/API or use the Merkle tree JSON file exported
    /// by the api3/dapi-management repo
    /// @return revertableDapiFallbacks Revertable dAPI fallbacks
    function getRevertableDapiFallbacks()
        external
        view
        override
        returns (bytes32[] memory revertableDapiFallbacks)
    {
        revertableDapiFallbacks = _revertableDapiFallbacks.values();
    }

    /// @notice Called privately to withdraw funds
    /// @param recipient Recipient address
    /// @param amount Amount
    function _withdraw(address payable recipient, uint256 amount) private {
        require(recipient != address(0), "Recipient address is zero");
        require(amount != 0, "Amount zero");
        Address.sendValue(recipient, amount);
        emit Withdrawn(recipient, amount, address(this).balance);
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
        require(proof.length != 0, "Proof empty");
        require(root != bytes32(0), "Root zero");
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(treeType) == root,
            "Tree root not registered"
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid tree proof");
    }
}

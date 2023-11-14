// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IBeaconUpdatesWithSignedData.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IDataFeedServer.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxyFactory.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IApi3Market.sol";
import "./interfaces/IDapiDataRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";
import "./interfaces/IHashRegistry.sol";

/// @title Contract that will be called to buy a managed dAPI subscription
/// @notice TODO
contract Api3Market is IApi3Market {
    bytes32 private constant DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI pricing Merkle tree root"));

    /// @notice HashRegistry contract address
    address public immutable override hashRegistry;
    /// @notice DapiDataRegistry contract address
    address public immutable override dapiDataRegistry;
    /// @notice DapiFallbackV2 contract address
    address public immutable override dapiFallbackV2;
    /// @notice ProxyFactory contract address
    address public immutable override proxyFactory;
    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;

    // TODO: should this be public?
    mapping(bytes32 => Purchase[]) public dapiToPurchases;

    /// @param _hashRegistry HashRegistry contract address
    /// @param _dapiDataRegistry DapiDataRegistry contract address
    /// @param _dapiFallbackV2 DapiFallbackV2 contract address
    /// @param _proxyFactory ProxyFactory contract address
    /// @param _api3ServerV1 Api3ServerV1 contract address
    constructor(
        address _hashRegistry,
        address _dapiDataRegistry,
        address _dapiFallbackV2,
        address _proxyFactory,
        address _api3ServerV1
    ) {
        require(_hashRegistry != address(0), "HashRegistry address is zero");
        require(
            _dapiDataRegistry != address(0),
            "DapiDataRegistry address is zero"
        );
        require(
            _dapiFallbackV2 != address(0),
            "DapiFallbackV2 address is zero"
        );
        require(_proxyFactory != address(0), "ProxyFactory address is zero");
        require(_api3ServerV1 != address(0), "Api3ServerV1 address is zero");
        hashRegistry = _hashRegistry;
        dapiDataRegistry = _dapiDataRegistry;
        dapiFallbackV2 = _dapiFallbackV2;
        proxyFactory = _proxyFactory;
        api3ServerV1 = _api3ServerV1;
    }

    /// @notice This function allows users to purchase a dAPI and update its
    /// parameters
    /// @dev This function makes use of 3 Merkle trees to validate the data
    /// needed for running a managed dAPI.
    /// @param args The arguments needed for the dAPI purchase. See
    /// IApi3Market.BuyDapiArgs struct for details on these arguments
    function buyDapi(BuyDapiArgs calldata args) external payable override {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(args.dapi.name));
        require(!_isFallbacked(dapiNameHash), "dAPI is fallbacked");
        require(args.beacons.length != 0, "Beacons is empty");
        require(
            args.beacons.length == args.signedApiUrlProofs.length,
            "Beacons and signed API URL proofs length mismatch"
        );
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(
                DAPI_PRICING_MERKLE_TREE_ROOT_HASH_TYPE
            ) == args.priceRoot,
            "Root has not been registered"
        );
        require(
            MerkleProof.verify(
                args.priceProof,
                args.priceRoot,
                keccak256(
                    bytes.concat(
                        keccak256(
                            abi.encode(
                                args.dapi.name,
                                block.chainid,
                                args.dapi.updateParams,
                                args.dapi.duration,
                                args.dapi.price
                            )
                        )
                    )
                )
            ),
            "Invalid proof"
        );

        UpdateParams memory updateParams = _decodeUpdateParams(
            args.dapi.updateParams
        );

        (
            uint256 updatedPrice,
            uint256 updatedDuration,
            bool isPendingDowngradeOrExtension
        ) = _processPayment(dapiNameHash, args.dapi, updateParams);

        // Store Signed API URLs for all the Airnodes used by the constituent beacons of the beaconSet
        _registerSignedApiUrl(
            args.beacons,
            args.signedApiUrlRoot,
            args.signedApiUrlProofs
        );

        // Store the actual data used to derive each beaconId (if more than one then it will also be used to derive the beaconSetId)
        bytes32 dataFeedId = _registerDataFeed(args.beacons);

        // Add the dAPI to the DapiDataRegistry for managed data feed updates
        // If purchase if future downgrade, then a worker needs to call this
        // function when downgrade period starts to update the update parameters
        // used by Airseeker
        if (!isPendingDowngradeOrExtension) {
            IDapiDataRegistry(dapiDataRegistry).addDapi(
                args.dapi.name,
                dataFeedId,
                args.dapi.sponsorWallet,
                updateParams.deviationThresholdInPercentage,
                updateParams.deviationReference,
                updateParams.heartbeatInterval,
                args.dapiRoot,
                args.dapiProof
            );
        }

        // Deploy the dAPI proxy (if it hasn't been deployed yet)
        address dapiProxyAddress = IProxyFactory(proxyFactory)
            .computeDapiProxyAddress(args.dapi.name, "");
        // https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/utils/ExtendedSelfMulticall.sol#L36
        if (dapiProxyAddress.code.length == 0) {
            IProxyFactory(proxyFactory).deployDapiProxy(args.dapi.name, "");
        }

        // Update the dAPI beacons with signed API data
        _updateDataFeed(
            dataFeedId,
            updateParams.heartbeatInterval,
            args.beacons
        );

        // This is done last because it is less trusted than other external calls
        if (msg.value - updatedPrice == 0) {
            Address.sendValue(args.dapi.sponsorWallet, msg.value);
        } else {
            Address.sendValue(args.dapi.sponsorWallet, updatedPrice);
            Address.sendValue(payable(msg.sender), msg.value - updatedPrice);
        }

        emit BoughtDapi(
            args.dapi.name,
            dataFeedId,
            dapiProxyAddress,
            updatedPrice,
            updatedDuration,
            args.dapi.updateParams,
            args.dapi.sponsorWallet.balance,
            msg.sender
        );
    }

    /// @notice Internal function to process payment for the dAPI purchase
    /// @dev Handles various scenarios including new purchase, upgrade, downgrade, and extension
    /// @param dapiNameHash Hash of the dAPI name
    /// @param dapi The dAPI being purchased
    /// @param updateParams Parameters for updating the dAPI
    /// @return updatedPrice The updated price for the dAPI
    /// @return updatedDuration The updated duration for the dAPI
    /// @return isPendingDowngradeOrExtension True if the purchase is pending a downgrade or extension
    function _processPayment(
        bytes32 dapiNameHash,
        Dapi calldata dapi,
        UpdateParams memory updateParams
    )
        private
        returns (
            uint256 updatedPrice,
            uint256 updatedDuration,
            bool isPendingDowngradeOrExtension
        )
    {
        updatedPrice = dapi.price;
        updatedDuration = dapi.duration;

        (bool found, uint256 index) = _findCurrentDapiPurchaseIndex(
            dapiNameHash
        );

        if (!found) {
            // Scenerio 1: No previous purchases
            dapiToPurchases[dapiNameHash].push(
                Purchase(
                    updateParams.deviationThresholdInPercentage,
                    updateParams.heartbeatInterval,
                    updatedPrice,
                    updatedDuration,
                    block.timestamp,
                    block.timestamp
                )
            );
        } else {
            Purchase storage current = dapiToPurchases[dapiNameHash][index];
            Purchase storage pending = current;
            uint256 purchasesLength = dapiToPurchases[dapiNameHash].length;
            if (purchasesLength > 1 && index == purchasesLength - 2) {
                pending = dapiToPurchases[dapiNameHash][purchasesLength - 1];
            }

            require(
                current.purchasedAt < block.timestamp - 1 days &&
                    current.purchasedAt < block.timestamp - 1 days,
                "dAPI has been purchased on the last day"
            );

            if (
                updateParams.deviationThresholdInPercentage >=
                current.deviationThreshold &&
                updateParams.heartbeatInterval >= current.heartbeatInterval
            ) {
                // Scenario 2: New purchase is downgrade or extension
                require(
                    (block.timestamp + dapi.duration) >
                        (current.start + current.duration),
                    "Does not extends nor downgrades current purchase"
                );
                // We only allow a single downgrade after last purchase
                require(
                    (pending.start + pending.duration) ==
                        (current.start + current.duration),
                    "There is already a pending extension or downgrade"
                );
                // Period after current ends
                updatedDuration =
                    (block.timestamp + dapi.duration) -
                    (current.start + current.duration);
                updatedPrice = (updatedDuration * dapi.price) / dapi.duration;
                isPendingDowngradeOrExtension = true;
                dapiToPurchases[dapiNameHash].push(
                    Purchase(
                        updateParams.deviationThresholdInPercentage,
                        updateParams.heartbeatInterval,
                        updatedPrice,
                        updatedDuration,
                        current.start + current.duration, // downgrade or extension starts when current ends
                        block.timestamp
                    )
                );
            } else {
                // Scenario 3: New purchase is upgrade
                uint256 currentOverlapDuration = (current.start +
                    current.duration) - block.timestamp;
                // Deduct the overlapped period already paid by current
                updatedPrice -=
                    (currentOverlapDuration * current.price) /
                    current.duration;
                dapiToPurchases[dapiNameHash].push(
                    Purchase(
                        updateParams.deviationThresholdInPercentage,
                        updateParams.heartbeatInterval,
                        dapi.price,
                        updatedDuration,
                        block.timestamp,
                        block.timestamp
                    )
                );
                if (
                    (pending.start + pending.duration) !=
                    (current.start + current.duration)
                ) {
                    // Also deduct overlapped period already paid by pending and
                    // adjust pending downgrade or extension start and duration
                    uint256 pendingOverlapDuration = Math.min(
                        (block.timestamp + dapi.duration),
                        (pending.start + pending.duration)
                    ) - pending.start;
                    updatedPrice -=
                        (pendingOverlapDuration * pending.price) /
                        pending.duration;

                    if (pendingOverlapDuration == pending.duration) {
                        // Purchase upgrades the pending downgrade or extension
                        delete dapiToPurchases[dapiNameHash][
                            purchasesLength - 2
                        ];
                    } else {
                        // Adjust remaining pending downgrade or extension values
                        uint256 updatedPendingDuration = (pending.duration -
                            pendingOverlapDuration);
                        pending.price =
                            (updatedPendingDuration * pending.price) /
                            pending.duration;
                        pending.duration = updatedPendingDuration;
                        pending.start = block.timestamp + dapi.duration;

                        _swapCurrentAndPending(dapiNameHash);
                    }
                }
            }
        }
        require(msg.value >= updatedPrice, "Insufficient payment");
    }

    /// @notice Internal function to swap the current and pending purchases in
    /// the mapping
    /// @dev Used when a new purchase is an upgrade, and the current purchase
    /// overlaps with a pending downgrade or extension
    /// @param dapiNameHash Hash of the dAPI name.
    function _swapCurrentAndPending(bytes32 dapiNameHash) private {
        uint256 purchasesLength = dapiToPurchases[dapiNameHash].length;
        if (purchasesLength > 1) {
            Purchase memory last = dapiToPurchases[dapiNameHash][
                purchasesLength - 1
            ];
            dapiToPurchases[dapiNameHash][
                purchasesLength - 1
            ] = dapiToPurchases[dapiNameHash][purchasesLength - 2];
            dapiToPurchases[dapiNameHash][purchasesLength - 2] = last;
        }
    }

    /// @notice Internal function to find the index of the current dAPI purchase
    /// @dev Searches through the purchase history to find the current purchase
    /// where current means that block.timestamp is somewhere in between start
    /// and date of a purchase
    /// @param dapiNameHash Hash of the dAPI name
    /// @return found True if a current purchase is found
    /// @return index Index of the current purchase in the purchase history
    function _findCurrentDapiPurchaseIndex(
        bytes32 dapiNameHash
    ) private view returns (bool found, uint256 index) {
        Purchase[] storage purchases = dapiToPurchases[dapiNameHash];
        if (purchases.length > 0) {
            for (uint256 ind = purchases.length; ind > 0; ind--) {
                Purchase storage purchase = purchases[ind - 1];
                if (
                    block.timestamp >= purchase.start &&
                    block.timestamp < purchase.start + purchase.duration
                ) {
                    found = true;
                    index = ind - 1;
                    break;
                }
            }
        }
    }

    /// @notice Checks if the dAPI has been fallbacked
    /// @dev Checks if the dAPI is in the list of fallbacked dAPIs in the
    /// DapiFallbackV2 contract
    /// @param dapiNameHash Hash of the dAPI name.
    /// @return isFallbacked True if dAPI name is in the list
    function _isFallbacked(
        bytes32 dapiNameHash
    ) private view returns (bool isFallbacked) {
        bytes32[] memory fallbackedDapis = IDapiFallbackV2(dapiFallbackV2)
            .getFallbackedDapis();
        for (uint256 i = 0; i < fallbackedDapis.length; i++) {
            if (
                keccak256(abi.encodePacked(fallbackedDapis[i])) == dapiNameHash
            ) {
                isFallbacked = true;
                break;
            }
        }
    }

    /// @notice Decodes the update parameters from the provided encoded data
    /// @dev Decodes the update parameters used in the dAPI purchase
    /// @param updateParams_ Encoded update parameters
    /// @return updateParams Decoded update parameters
    function _decodeUpdateParams(
        bytes calldata updateParams_
    ) private pure returns (UpdateParams memory updateParams) {
        (
            uint256 deviationThresholdInPercentage,
            int224 deviationReference,
            uint32 heartbeatInterval
        ) = abi.decode(updateParams_, (uint256, int224, uint32));
        updateParams = UpdateParams(
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval
        );
    }

    /// @notice Registers the data feed data for the dAPI
    /// @dev Registers this data in the DapiDataRegistry contract
    /// @param beacons The values of the beacons associated with the dAPI
    /// @return dataFeedId The ID of the registered data feed
    function _registerDataFeed(
        Beacon[] calldata beacons
    ) private returns (bytes32 dataFeedId) {
        if (beacons.length == 1) {
            dataFeedId = IDapiDataRegistry(dapiDataRegistry).registerDataFeed(
                abi.encode(beacons[0].airnode, beacons[0].templateId)
            );
        } else {
            address[] memory airnodes = new address[](beacons.length);
            bytes32[] memory templateIds = new bytes32[](beacons.length);
            for (uint ind = 0; ind < beacons.length; ind++) {
                airnodes[ind] = beacons[ind].airnode;
                templateIds[ind] = beacons[ind].templateId;
            }
            dataFeedId = IDapiDataRegistry(dapiDataRegistry).registerDataFeed(
                abi.encode(airnodes, templateIds)
            );
        }
    }

    /// @notice Updates the data feed with signed API data
    /// @dev Calls the Api3ServerV1 contract to update the data feed values using
    /// API data signed by each Airnode
    /// @param dataFeedId The ID of the data feed to be updated
    /// @param heartbeatInterval The heartbeat interval for the data feed
    /// @param beacons The values of the beacons associated with the data feed
    function _updateDataFeed(
        bytes32 dataFeedId,
        uint256 heartbeatInterval,
        Beacon[] calldata beacons
    ) private {
        (, uint32 timestamp) = IApi3ServerV1(api3ServerV1).dataFeeds(
            dataFeedId
        );
        // Only update data feed values if they haven't been updated recently
        if (timestamp + heartbeatInterval <= block.timestamp) {
            bytes32[] memory beaconIds = new bytes32[](beacons.length);
            bytes[] memory calldatas = new bytes[](beacons.length + 1);
            for (uint256 ind = 0; ind < beacons.length; ind++) {
                beaconIds[ind] = keccak256(
                    abi.encodePacked(
                        beacons[ind].airnode,
                        beacons[ind].templateId
                    )
                );
                calldatas[ind] = abi.encodeCall(
                    IBeaconUpdatesWithSignedData.updateBeaconWithSignedData,
                    (
                        beacons[ind].airnode,
                        beacons[ind].templateId,
                        beacons[ind].timestamp, // Signature timestamp
                        beacons[ind].data, // Update data (an `int256` encoded in contract ABI)
                        beacons[ind].signature // Template ID, timestamp and the update data signed by the Airnode
                    )
                );
            }

            if (beacons.length > 1) {
                calldatas[beacons.length] = abi.encodeCall(
                    IDataFeedServer.updateBeaconSetWithBeacons,
                    (beaconIds)
                );
            }

            IApi3ServerV1(api3ServerV1).tryMulticall(calldatas);
        }
    }

    /// @notice Registers signed API URLs for each Airnode used to update each
    /// beacon
    /// @dev Checks if the signed API URLs have already been registered and
    /// registers them if not
    /// @param beacons The values of the beacons associated with the dAPI
    /// @param signedApiUrlRoot The root hash of the Merkle tree containing signed API URLs
    /// @param signedApiUrlProofs Merkle proofs for the signed API URLs
    function _registerSignedApiUrl(
        Beacon[] memory beacons,
        bytes32 signedApiUrlRoot,
        bytes32[][] memory signedApiUrlProofs
    ) private {
        bytes[] memory calldatas = new bytes[](signedApiUrlProofs.length);
        for (uint ind = 0; ind < signedApiUrlProofs.length; ind++) {
            calldatas[ind] = abi.encodeCall(
                IDapiDataRegistry.airnodeToSignedApiUrl,
                (beacons[ind].airnode)
            );
        }
        bytes[] memory returndatas = IDapiDataRegistry(dapiDataRegistry)
            .multicall(calldatas);
        for (uint ind = 0; ind < signedApiUrlProofs.length; ind++) {
            if (
                returndatas[ind].length == 0 ||
                (keccak256(abi.encodePacked((returndatas[ind]))) !=
                    keccak256(abi.encodePacked((beacons[ind].url))))
            ) {
                IDapiDataRegistry(dapiDataRegistry).registerAirnodeSignedApiUrl(
                        beacons[ind].airnode,
                        beacons[ind].url,
                        signedApiUrlRoot,
                        signedApiUrlProofs[ind]
                    );
            }
        }
    }

    /// @notice Reads the current and pending purchases for a specific dAPI
    /// @dev Returns the current and pending purchases for a given dAPI name
    /// @param dapiName The encoded bytes32 name of the dAPI
    /// @return current The current purchase information
    /// @return pending The pending purchase information
    function readCurrentAndPendingPurchases(
        bytes32 dapiName
    )
        external
        view
        override
        returns (Purchase memory current, Purchase memory pending)
    {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        (bool found, uint256 index) = _findCurrentDapiPurchaseIndex(
            dapiNameHash
        );
        if (found) {
            uint256 purchasesLength = dapiToPurchases[dapiNameHash].length;
            current = dapiToPurchases[dapiNameHash][index];
            if (purchasesLength > 1 && index == purchasesLength - 2) {
                pending = dapiToPurchases[dapiNameHash][index + 1];
            }
        }
    }

    /// @notice Reads a specific purchase for a given dAPI with a specified index
    /// @dev Returns the purchase information for a specific index in the
    /// purchase history of a given dAPI
    /// @param dapiName The encoded bytes32 name of the dAPI
    /// @param index The index of the purchase in the purchase history
    /// @return purchase The purchase information
    function readDapiPurchaseWithIndex(
        bytes32 dapiName,
        uint256 index
    ) external view override returns (Purchase memory purchase) {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        if (index < dapiToPurchases[dapiNameHash].length) {
            purchase = dapiToPurchases[dapiNameHash][index];
        }
    }
}

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

/// @title Managed dAPI Subscription Market
/// @notice This contract facilitates the purchase and management of
/// decentralized API (dAPI) subscriptions within the API3 ecosystem. Users can
/// buy a managed dAPI subscription, and the contract handles various scenarios
/// such as new purchases, upgrades, downgrades, and extensions
/// @dev Caller must provide all the information required for running a managed
/// dAPI while making a purchase. It is also required to send signed data for
/// each beacon in order for the data feed to be up-to-date after purchase.
/// Subsequent purchases for the same dAPI should cost less if the underlying
/// configuration does not change (i.e. same set of beacons that point to the
/// same Airnode addresses for which signed API URLs have not changed). This is
/// because there will be no need to update the values in the `DapiDataRegistry`
/// contract. This contract also handles deploying a new dAPI proxy contract if
/// needed and value left from the purchase after making price adjustments will
/// be returned to the caller
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

    /// @notice Hisotry of dAPI purchases
    /// @dev Key: Hash of dAPI name, Value: Array of Purchase structs
    mapping(bytes32 => Purchase[]) private dapiToPurchases;

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

    /// @notice Called by anyone to purchase a dAPI and update its parameters
    /// @dev This function makes use of three Merkle trees to validate the data
    /// needed for running a managed dAPI. Refer to the `IApi3Market.BuyDapiArgs`
    /// struct for detailed information on dAPI purchase and update arguments
    /// @param args The arguments needed for the dAPI purchase
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

        // Store Signed API URLs for each Airnode used to update each beacon
        _registerSignedApiUrl(
            args.beacons,
            args.signedApiUrlRoot,
            args.signedApiUrlProofs
        );

        // Store the actual data used to derive each beaconId (Airnode address
        // and templateId). If more than one is provided in the arguments list
        // then each beaconId will be used to derive the beaconSetId
        bytes32 dataFeedId = _registerDataFeed(args.beacons);

        // Add the dAPI to the DapiDataRegistry for managed data feed updates
        // If purchase is future downgrade, then a worker needs to call the
        // `addDapi()` function when downgrade period starts to update the update
        // parameters used by Airseeker
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

        // Deploy the dAPI proxy to read the data feed value
        address dapiProxy = IProxyFactory(proxyFactory).computeDapiProxyAddress(
            args.dapi.name,
            ""
        );
        if (dapiProxy.code.length == 0) {
            IProxyFactory(proxyFactory).deployDapiProxy(args.dapi.name, "");
        }

        // Update the dAPI beacons with signed API data. This also tries to
        // update the beaconSet if more than one beacon was provided
        _updateDataFeed(
            dataFeedId,
            updateParams.heartbeatInterval,
            args.beacons
        );

        // The price of the dAPI might change in cases where the purchase
        // upgrades, downgrades or extends the current purchase. Therefore we
        // only charge the caller the difference and send back the rest
        Address.sendValue(args.dapi.sponsorWallet, updatedPrice);
        if (msg.value - updatedPrice > 0) {
            Address.sendValue(payable(msg.sender), msg.value - updatedPrice);
        }

        emit BoughtDapi(
            args.dapi.name,
            dataFeedId,
            dapiProxy,
            updatedPrice,
            updatedDuration,
            args.dapi.updateParams,
            args.dapi.sponsorWallet.balance,
            msg.sender
        );
    }

    /// @notice Checks if the dAPI has been fallbacked
    /// @dev Checks if the dAPI is in the list of fallbacked dAPIs in the
    /// DapiFallbackV2 contract
    /// @param dapiNameHash Hash of the dAPI name
    /// @return isFallbacked True if dAPI name is in the list
    function _isFallbacked(
        bytes32 dapiNameHash
    ) private view returns (bool isFallbacked) {
        bytes32[] memory fallbackedDapis = IDapiFallbackV2(dapiFallbackV2)
            .getRevertableDapiFallbacks();
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

    /// @notice Process payment for the dAPI purchase
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
                    pending.purchasedAt < block.timestamp - 1 days,
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

    /// @notice Finds the index of the current dAPI purchase
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

    /// @notice Swaps the current and pending purchases in the mapping
    /// @dev Called when a new purchase is an upgrade, and it overlaps with a
    /// pending downgrade or extension. This is needed because new purchases are
    /// always pushed at the end of the array
    /// @param dapiNameHash Hash of the dAPI name
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

    /// @notice Registers signed API URLs for each Airnode used to update each
    /// beacon
    /// @dev Checks if the signed API URLs have already been registered. If not,
    /// then it registers the URLs in the DapiDataRegistry contract
    /// @param beacons Values for the beacons associated with the dAPI
    /// @param signedApiUrlRoot Merkle tree root hash
    /// @param signedApiUrlProofs Array of hashes to verify a Merkle tree leaf
    function _registerSignedApiUrl(
        Beacon[] memory beacons,
        bytes32 signedApiUrlRoot,
        bytes32[][] memory signedApiUrlProofs
    ) private {
        bytes[] memory calldatas = new bytes[](beacons.length);
        for (uint ind = 0; ind < beacons.length; ind++) {
            calldatas[ind] = abi.encodeCall(
                IDapiDataRegistry.airnodeToSignedApiUrl,
                (beacons[ind].airnode)
            );
        }
        bytes[] memory returndatas = IDapiDataRegistry(dapiDataRegistry)
            .multicall(calldatas);
        for (uint ind = 0; ind < beacons.length; ind++) {
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

    /// @notice Registers the data feed data for the dAPI
    /// @dev Registers this data in the DapiDataRegistry contract
    /// @param beacons Values for the beacons associated with the dAPI
    /// @return dataFeedId Registered data feed ID
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
    /// @param dataFeedId Data feed ID to be updated
    /// @param heartbeatInterval Heartbeat interval for the data feed
    /// @param beacons Values for the beacons associated with the dAPI
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

    /// @notice Reads the current and pending purchases for a specific dAPI
    /// @dev Returns the current and pending purchases for a given dAPI name
    /// @param dapiName Encoded bytes32 name of the dAPI
    /// @return current Current purchase information
    /// @return pending Pending purchase information
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
    /// @param dapiName Encoded bytes32 name of the dAPI
    /// @param index Index of the purchase in the purchase history array
    /// @return purchase dAPI purchase information
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

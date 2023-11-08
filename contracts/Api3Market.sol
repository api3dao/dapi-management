// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxyFactory.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./interfaces/IApi3Market.sol";
import "./interfaces/IDapiDataRegistry.sol";
import "./interfaces/IDapiFallbackV2.sol";
import "./interfaces/IHashRegistry.sol";

/// @title
/// @notice
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
        // TODO: should this contract get the Api3ServerV1 address from
        // DapiDataRegistry or from ProxyFactory contracts instead?
        api3ServerV1 = _api3ServerV1;
    }

    // This function must use the 3 Merkle trees to store the data needed for running a managed dAPI
    function buyDapi(BuyDapiArgs calldata args) external payable override {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(args.dapi.name));
        _isFallbacked(dapiNameHash);
        require(args.beacons.length != 0, "Beacons is empty");
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

        // TODO: handle downgrade/upgrade
        //       say we have 0.25% active for the next 3 months and someone wants
        //       to come in and buy 1% for the next 6 months, which means they
        //       should only pay for 1% for 3 months and the dAPI to be
        //       downgraded to 1% after 3 months
        // TODO: Need to use some sort of Checkpoint or Queue data structure to store subscriptions?
        UpdateParams memory updateParams = _decodeUpdateParams(
            args.dapi.updateParams
        );

        (uint256 updatedPrice, uint256 updatedDuration) = _processPayment(
            dapiNameHash,
            args.dapi,
            updateParams
        );

        // Store Signed API URLs for all the Airnodes used by the constituent beacons of the beaconSet
        require(
            args.beacons.length == args.signedApiUrlProofs.length,
            "Signed API URL proofs length is incorrect"
        );
        for (uint ind = 0; ind < args.signedApiUrlProofs.length; ind++) {
            // TODO: This is very naive and does not check if url being registered is the same for the current airnode
            //       Should we add that check to avoid re-setting the same value to state if values are equal?
            IDapiDataRegistry(dapiDataRegistry).registerAirnodeSignedApiUrl(
                args.beacons[ind].airnode,
                args.beacons[ind].url,
                args.signedApiUrlRoot,
                args.signedApiUrlProofs[ind]
            );
        }

        // Store the actual data used to derive each beaconId (if more than one then it will also be used to derive the beaconSetId)
        bytes32 dataFeedId = _registerDataFeed(args.beacons);

        // Add the dAPI to the DapiDataRegistry for managed data feed updates
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

        // Deploy the dAPI proxy (if it hasn't been deployed yet)
        address dapiProxyAddress = IProxyFactory(proxyFactory)
            .computeDapiProxyAddress(args.dapi.name, "");
        // https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/utils/ExtendedSelfMulticall.sol#L36
        if (dapiProxyAddress.code.length == 0) {
            IProxyFactory(proxyFactory).deployDapiProxy(args.dapi.name, "");
        }

        // Update the dAPI with signed API data (if it hasn't been updated recently)
        _updateDataFeed(
            dataFeedId,
            updateParams.heartbeatInterval,
            args.beacons
        );

        // This is done last because it is less trusted than other external calls
        Address.sendValue(args.dapi.sponsorWallet, msg.value);

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

    function _processPayment(
        bytes32 dapiNameHash,
        Dapi calldata dapi,
        UpdateParams memory updateParams
    ) private returns (uint256 updatedPrice, uint256 updatedDuration) {
        updatedPrice = dapi.price;
        updatedDuration = dapi.duration;
        uint256 purchaseEnd = block.timestamp + dapi.duration;

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
                    purchaseEnd
                )
            );
        } else {
            Purchase storage current = dapiToPurchases[dapiNameHash][index];
            Purchase storage downgrade = current;
            uint256 purchasesLength = dapiToPurchases[dapiNameHash].length;
            if (index == purchasesLength - 1) {
                // We only allow a single downgrade after last purchase
                downgrade = dapiToPurchases[dapiNameHash][purchasesLength];
            }

            // Scenario 2: New purchase is downgrade or extension
            // TODO: is it OK to restrict purchases to end after current period ends?
            require(
                purchaseEnd > current.end,
                "Does not extends nor downgrades current purchase"
            );

            if (
                // TODO: not 100% sure this is the right way to determine if upgrade
                // or downgrade but this is the way it's currently being done in
                // operation-database backend
                updateParams.deviationThresholdInPercentage >=
                current.deviationThreshold &&
                updateParams.heartbeatInterval >= current.heartbeatInterval
            ) {
                require(
                    downgrade.end != current.end,
                    "There is already a pending extension or downgrade"
                );
                updatedDuration = purchaseEnd - current.end;
                updatedPrice = (updatedDuration * dapi.price) / dapi.duration;
                dapiToPurchases[dapiNameHash].push(
                    Purchase(
                        updateParams.deviationThresholdInPercentage,
                        updateParams.heartbeatInterval,
                        updatedPrice,
                        updatedDuration,
                        block.timestamp,
                        purchaseEnd
                    )
                );
            } else {
                // Scenario 3: New purchase is upgrade
                uint256 currentOverlapDuration = current.end - block.timestamp;
                updatedPrice -=
                    (currentOverlapDuration * current.price) /
                    current.duration;

                if (downgrade.end != current.end) {
                    // Also deduct and adjust downgrade
                    uint256 downgradeOverlapDuration = Math.min(
                        purchaseEnd,
                        downgrade.end
                    ) - downgrade.start;
                    updatedPrice -=
                        (downgradeOverlapDuration * downgrade.price) /
                        downgrade.duration;
                    if (downgradeOverlapDuration == downgrade.duration) {
                        // Purchase upgrades the downgrade completely
                        delete dapiToPurchases[dapiNameHash][purchasesLength];
                    } else {
                        // Adjust downgrade
                        uint256 updatedDowngradeDuration = (downgrade.duration -
                            downgradeOverlapDuration);
                        downgrade.price =
                            (updatedDowngradeDuration * downgrade.price) /
                            downgrade.duration;
                        downgrade.duration = updatedDowngradeDuration;
                        downgrade.start += updatedDowngradeDuration;
                    }
                }

                dapiToPurchases[dapiNameHash].push(
                    Purchase(
                        updateParams.deviationThresholdInPercentage,
                        updateParams.heartbeatInterval,
                        updatedPrice,
                        updatedDuration,
                        block.timestamp,
                        purchaseEnd
                    )
                );
            }
        }
        require(msg.value >= updatedPrice, "Insufficient payment");
    }

    function _findCurrentDapiPurchaseIndex(
        bytes32 dapiNameHash
    ) private view returns (bool found, uint256 index) {
        Purchase[] storage purchases = dapiToPurchases[dapiNameHash];
        if (purchases.length > 0) {
            for (uint256 ind = purchases.length; ind > 0; ind--) {
                Purchase storage purchase = purchases[ind - 1];
                if (
                    block.timestamp >= purchase.start &&
                    block.timestamp < purchase.end
                ) {
                    found = true;
                    index = ind - 1;
                    break;
                }
            }
        }
    }

    function _isFallbacked(bytes32 dapiNameHash) private view {
        bytes32[] memory fallbackedDapis = IDapiFallbackV2(dapiFallbackV2)
            .getFallbackedDapis();
        for (uint256 i = 0; i < fallbackedDapis.length; i++) {
            require(fallbackedDapis[i] != dapiNameHash, "Dapi is fallbacked");
        }
    }

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

    function _updateDataFeed(
        bytes32 dataFeedId,
        uint256 heartbeatInterval,
        Beacon[] calldata beacons
    ) private {
        (, uint32 timestamp) = IApi3ServerV1(api3ServerV1).dataFeeds(
            dataFeedId
        );
        if (timestamp + heartbeatInterval <= block.timestamp) {
            bytes32[] memory beaconIds = new bytes32[](beacons.length);
            for (uint ind = 0; ind < beacons.length; ind++) {
                beaconIds[ind] = IApi3ServerV1(api3ServerV1)
                    .updateBeaconWithSignedData(
                        beacons[ind].airnode,
                        beacons[ind].templateId,
                        beacons[ind].timestamp, // Signature timestamp
                        beacons[ind].data, // Update data (an `int256` encoded in contract ABI)
                        beacons[ind].signature // Template ID, timestamp and the update data signed by the Airnode
                    );
            }
            // TODO: only do this if beacons.length > 1?
            IApi3ServerV1(api3ServerV1).updateBeaconSetWithBeacons(beaconIds);
        }
    }
}

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

        UpdateParams memory updateParams = _decodeUpdateParams(
            args.dapi.updateParams
        );

        (uint256 updatedPrice, uint256 updatedDuration) = _processPayment(
            dapiNameHash,
            args.dapi,
            updateParams
        );

        // Store Signed API URLs for all the Airnodes used by the constituent beacons of the beaconSet
        _registerSignedApiUrl(
            args.beacons,
            args.signedApiUrlRoot,
            args.signedApiUrlProofs
        );

        // Store the actual data used to derive each beaconId (if more than one then it will also be used to derive the beaconSetId)
        bytes32 dataFeedId = _registerDataFeed(args.beacons);

        // Add the dAPI to the DapiDataRegistry for managed data feed updates
        // TODO: do not call if downgrade. Worker needs to call this function
        // when downgrade period starts to update the update parameters used by
        // Airseeker. How to determine current purchase is a downgrade here?
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
            Purchase memory current = dapiToPurchases[dapiNameHash][index];
            Purchase memory downgrade = current;
            uint256 purchasesLength = dapiToPurchases[dapiNameHash].length;
            if (purchasesLength > 1 && index == purchasesLength - 2) {
                downgrade = dapiToPurchases[dapiNameHash][purchasesLength - 1];
            }

            if (
                // TODO: not 100% sure this is the right way to determine if upgrade
                // or downgrade but this is the way it's currently being done in
                // operation-database backend
                updateParams.deviationThresholdInPercentage >=
                current.deviationThreshold &&
                updateParams.heartbeatInterval >= current.heartbeatInterval
            ) {
                // Scenario 2: New purchase is downgrade or extension
                // TODO: is it OK to restrict purchases to end after current period ends?
                require(
                    purchaseEnd > current.end,
                    "Does not extends nor downgrades current purchase"
                );
                // We only allow a single downgrade after last purchase
                require(
                    downgrade.end == current.end,
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
                        current.end,
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
            require(
                keccak256(abi.encodePacked(fallbackedDapis[i])) != dapiNameHash,
                "Dapi is fallbacked"
            );
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

    function _registerSignedApiUrl(
        Beacon[] memory beacons,
        bytes32 signedApiUrlRoot,
        bytes32[][] memory signedApiUrlProofs
    ) private {
        require(
            beacons.length == signedApiUrlProofs.length,
            "Signed API URL proofs length is incorrect"
        );
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

    // TODO: add view function to read current purchase (and pending downgrade if
    // exists) for a given dAPI name
}

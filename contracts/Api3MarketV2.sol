// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./HashRegistryV2.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxyFactory.sol";
import "./AirseekerRegistry.sol";

// ~~~~~~~~~~~~~~~~~~~~~ IN DRAFT FORM ~~~~~~~~~~~~~~~~~~~~~
contract Api3MarketV2 is HashRegistryV2 {
    struct Subscription {
        uint32 currentEndTimestamp;
        uint32 nextEndTimestamp;
        uint256 currentDailyPrice;
        uint256 nextDailyPrice;
        bytes currentUpdateParameters;
        bytes nextUpdateParameters;
    }

    address public immutable api3ServerV1;

    address public immutable proxyFactory;

    address public immutable airseekerRegistry;

    mapping(bytes32 => Subscription) public dapiNameToSubscription;

    bytes32 private constant DAPI_MANAGEMENT_MERKLE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI management Merkle root"));

    bytes32 private constant DAPI_PRICING_MERKLE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI pricing Merkle root"));

    bytes32 private constant SIGNED_API_URL_MERKLE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("Signed API URL Merkle root"));

    uint256 private constant MAXIMUM_DAPI_UPDATE_AGE = 1 days;

    constructor(
        address owner_,
        address proxyFactory_,
        address airseekerRegistry_
    ) HashRegistryV2(owner_) {
        require(proxyFactory_ != address(0), "ProxyFactory address zero");
        require(
            airseekerRegistry_ != address(0),
            "AirseekerRegistry address zero"
        );
        proxyFactory = proxyFactory_;
        api3ServerV1 = IProxyFactory(proxyFactory_).api3ServerV1();
        require(
            api3ServerV1 ==
                AirseekerRegistry(airseekerRegistry_).api3ServerV1(),
            "Api3ServerV1 address mismatch"
        );
        airseekerRegistry = airseekerRegistry_;
    }

    // Options:
    // 1. Buy when there is no active subscription (overwrites)
    // 2. Upgrade both duration and update parameters (overwrites)
    // 3. Upgrade the duration and keep the update parameters the same (overwrites)
    // 4. Upgrade the update parameters and keep the duration the same (overwrites)
    // 5. Upgrade the duration while downgrading the update parameters while there
    // is no queue (appends)
    // 6. Upgrade the duration while upgrading the queue (overwrites the queue)

    // TODO: Do not allow ultra short downgrades

    function buyDapiSubscription(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address payable sponsorWallet,
        bytes calldata dapiManagementMerkleData,
        bytes calldata updateParameters,
        uint256 duration,
        uint256 price,
        bytes calldata dapiPricingMerkleData
    ) external payable {
        verifyDapiManagementMerkleProof(
            dapiName,
            dataFeedId,
            sponsorWallet,
            dapiManagementMerkleData
        );
        verifyDapiPricingMerkleProof(
            dapiName,
            updateParameters,
            duration,
            price,
            dapiPricingMerkleData
        );
        validateDataFeedReadiness(dataFeedId);
        Subscription storage subscription = dapiNameToSubscription[dapiName];
        uint256 requiredSponsorWalletBalance;
        if (subscription.currentEndTimestamp <= block.timestamp) {
            // Activating an inactive dAPI
            require(
                subscription.nextEndTimestamp <= block.timestamp,
                "Subscription needs update"
            );
            dapiNameToSubscription[dapiName] = Subscription({
                currentEndTimestamp: uint32(block.timestamp + duration),
                nextEndTimestamp: 0,
                currentDailyPrice: (price * duration) / 1 days,
                nextDailyPrice: 0,
                currentUpdateParameters: updateParameters,
                nextUpdateParameters: bytes("")
            });
            AirseekerRegistry(airseekerRegistry)
                .setUpdateParametersWithDapiName(dapiName, updateParameters);
            requiredSponsorWalletBalance = price;
            IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);
        } else if (
            upgradesSubscription(
                updateParameters,
                subscription.currentUpdateParameters,
                subscription.currentEndTimestamp,
                uint32(block.timestamp + duration)
            )
        ) {
            // Upgrading the current subscription
            dapiNameToSubscription[dapiName] = Subscription({
                currentEndTimestamp: uint32(block.timestamp + duration),
                nextEndTimestamp: subscription.nextEndTimestamp,
                currentDailyPrice: (price * duration) / 1 days,
                nextDailyPrice: subscription.nextDailyPrice,
                currentUpdateParameters: updateParameters,
                nextUpdateParameters: subscription.nextUpdateParameters
            });
            AirseekerRegistry(airseekerRegistry)
                .setUpdateParametersWithDapiName(dapiName, updateParameters);
            requiredSponsorWalletBalance = price;
            if (
                subscription.nextEndTimestamp > subscription.currentEndTimestamp
            ) {
                requiredSponsorWalletBalance +=
                    ((subscription.nextEndTimestamp -
                        subscription.currentEndTimestamp) *
                        subscription.nextDailyPrice) /
                    1 days;
            }
        } else if (
            upgradesSubscription(
                updateParameters,
                subscription.nextUpdateParameters,
                subscription.nextEndTimestamp,
                uint32(subscription.currentEndTimestamp + duration)
            )
        ) {
            // Upgrading the next subscription
            dapiNameToSubscription[dapiName] = Subscription({
                currentEndTimestamp: subscription.currentEndTimestamp,
                nextEndTimestamp: uint32(
                    subscription.currentEndTimestamp + duration
                ),
                currentDailyPrice: subscription.currentDailyPrice,
                nextDailyPrice: (price * duration) / 1 days,
                currentUpdateParameters: subscription.currentUpdateParameters,
                nextUpdateParameters: updateParameters
            });
            requiredSponsorWalletBalance =
                (subscription.currentEndTimestamp - block.timestamp) *
                subscription.currentDailyPrice +
                price; // wrong
        } else {
            revert("Does not upgrade subscriptions");
        }
        uint256 sponsorWalletBalance = sponsorWallet.balance;
        require(
            sponsorWalletBalance + msg.value >= requiredSponsorWalletBalance,
            "Insufficient payment"
        );
        Address.sendValue(sponsorWallet, msg.value);
    }

    function updateSubscription(bytes32 dapiName) public {
        Subscription storage subscription = dapiNameToSubscription[dapiName];
        require(
            subscription.currentEndTimestamp <= block.timestamp,
            "Cannot update subscription yet"
        );
        require(
            subscription.nextEndTimestamp > block.timestamp,
            "Update not available"
        );
        AirseekerRegistry(airseekerRegistry).setUpdateParametersWithDapiName(
            dapiName,
            subscription.nextUpdateParameters
        );
        dapiNameToSubscription[dapiName] = Subscription({
            currentEndTimestamp: subscription.nextEndTimestamp,
            nextEndTimestamp: 0,
            currentDailyPrice: subscription.nextDailyPrice,
            nextDailyPrice: 0,
            currentUpdateParameters: subscription.nextUpdateParameters,
            nextUpdateParameters: bytes("")
        });
    }

    function endSubscription(bytes32 dapiName) public {
        Subscription storage subscription = dapiNameToSubscription[dapiName];
        require(
            subscription.currentEndTimestamp <= block.timestamp,
            "Cannot end subscription yet"
        );
        require(
            subscription.nextEndTimestamp <= block.timestamp,
            "Subscription needs update"
        );
        AirseekerRegistry(airseekerRegistry).deactivateDataFeedIdOrDapiName(
            dapiName
        );
        IApi3ServerV1(api3ServerV1).setDapiName(dapiName, bytes32(0));
        delete dapiNameToSubscription[dapiName];
    }

    function updateSetDapiName(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        bytes calldata dapiManagementMerkleData
    ) external {
        verifyDapiManagementMerkleProof(
            dapiName,
            dataFeedId,
            sponsorWallet,
            dapiManagementMerkleData
        );
        bytes32 currentDataFeedId = IApi3ServerV1(api3ServerV1)
            .dapiNameHashToDataFeedId(keccak256(abi.encodePacked(dapiName)));
        require(currentDataFeedId != bytes32(0), "dAPI name not set");
        require(currentDataFeedId != dataFeedId, "Does not update dAPI name");
        validateDataFeedReadiness(dataFeedId);
        IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);
    }

    function setSignedApiUrl(
        address airnode,
        string calldata signedApiUrl,
        bytes calldata signedApiUrlMerkleData
    ) external {
        verifySignedApiUrlMerkleProof(
            airnode,
            signedApiUrl,
            signedApiUrlMerkleData
        );
        AirseekerRegistry(airseekerRegistry).setSignedApiUrl(
            airnode,
            signedApiUrl
        );
    }

    function updateBeaconWithSignedData(
        address airnode,
        bytes32 templateId,
        uint256 timestamp,
        bytes calldata data,
        bytes calldata signature
    ) external returns (bytes32 beaconId) {
        return
            IApi3ServerV1(api3ServerV1).updateBeaconWithSignedData(
                airnode,
                templateId,
                timestamp,
                data,
                signature
            );
    }

    function updateBeaconSetWithBeacons(
        bytes32[] calldata beaconIds
    ) external returns (bytes32 beaconSetId) {
        return
            IApi3ServerV1(api3ServerV1).updateBeaconSetWithBeacons(beaconIds);
    }

    function deployDapiProxy(
        bytes32 dapiName
    ) external returns (address proxyAddress) {
        proxyAddress = IProxyFactory(proxyFactory).deployDapiProxy(
            dapiName,
            ""
        );
    }

    function registerDataFeed(
        bytes calldata dataFeedDetails
    ) external returns (bytes32 dataFeedId) {
        dataFeedId = AirseekerRegistry(airseekerRegistry).registerDataFeed(
            dataFeedDetails
        );
    }

    function validateDataFeedReadiness(bytes32 dataFeedId) private view {
        (, uint32 timestamp) = IApi3ServerV1(api3ServerV1).dataFeeds(
            dataFeedId
        );
        require(
            block.timestamp + MAXIMUM_DAPI_UPDATE_AGE >= timestamp,
            "dAPI value stale"
        );
        require(
            AirseekerRegistry(airseekerRegistry)
                .dataFeedIdToDetails(dataFeedId)
                .length != 0,
            "Data feed not registered"
        );
    }

    function verifyDapiManagementMerkleProof(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        bytes calldata dapiManagementMerkleData
    ) private view {
        require(dapiName != bytes32(0), "dAPI name zero");
        if (dataFeedId != bytes32(0)) {
            require(sponsorWallet != address(0), "Sponsor wallet address zero");
        } else {
            // A zero `dataFeedId` is used to disable a dAPI. In that case, the
            // sponsor wallet address is also expected to be zero.
            require(
                sponsorWallet == address(0),
                "Sponsor wallet address not zero"
            );
        }
        (
            bytes32 dapiManagementMerkleRoot,
            bytes32[] memory dapiManagementMerkleProof
        ) = abi.decode(dapiManagementMerkleData, (bytes32, bytes32[]));
        require(
            hashes[DAPI_MANAGEMENT_MERKLE_ROOT_HASH_TYPE].value ==
                dapiManagementMerkleRoot,
            "Invalid root"
        );
        require(
            MerkleProof.verify(
                dapiManagementMerkleProof,
                dapiManagementMerkleRoot,
                keccak256(
                    bytes.concat(
                        keccak256(
                            abi.encode(dapiName, dataFeedId, sponsorWallet)
                        )
                    )
                )
            ),
            "Invalid proof"
        );
    }

    function verifyDapiPricingMerkleProof(
        bytes32 dapiName,
        bytes calldata updateParameters,
        uint256 duration,
        uint256 price,
        bytes calldata dapiPricingMerkleData
    ) private view {
        require(dapiName != bytes32(0), "dAPI name zero");
        require(
            updateParameters.length == 96,
            "Update parameters length invalid"
        );
        require(duration != 0, "Duration zero");
        require(price != 0, "Price zero");
        (
            bytes32 dapiPricingMerkleRoot,
            bytes32[] memory dapiPricingMerkleProof
        ) = abi.decode(dapiPricingMerkleData, (bytes32, bytes32[]));
        require(
            hashes[DAPI_PRICING_MERKLE_ROOT_HASH_TYPE].value ==
                dapiPricingMerkleRoot,
            "Invalid root"
        );
        require(
            MerkleProof.verify(
                dapiPricingMerkleProof,
                dapiPricingMerkleRoot,
                keccak256(
                    bytes.concat(
                        keccak256(
                            abi.encode(
                                dapiName,
                                block.chainid,
                                updateParameters,
                                duration,
                                price
                            )
                        )
                    )
                )
            ),
            "Invalid proof"
        );
    }

    function verifySignedApiUrlMerkleProof(
        address airnode,
        string calldata signedApiUrl,
        bytes calldata signedApiUrlMerkleData
    ) private view {
        (
            bytes32 signedApiUrlMerkleRoot,
            bytes32[] memory signedApiUrlMerkleProof
        ) = abi.decode(signedApiUrlMerkleData, (bytes32, bytes32[]));
        require(
            hashes[SIGNED_API_URL_MERKLE_ROOT_HASH_TYPE].value ==
                signedApiUrlMerkleRoot,
            "Invalid root"
        );
        require(
            MerkleProof.verify(
                signedApiUrlMerkleProof,
                signedApiUrlMerkleRoot,
                keccak256(
                    bytes.concat(keccak256(abi.encode(airnode, signedApiUrl)))
                )
            ),
            "Invalid proof"
        );
    }

    function upgradesSubscription(
        bytes calldata newUpdateParameters,
        bytes memory updateParameters,
        uint32 newEndTimestamp,
        uint32 endTimestamp
    ) private view returns (bool) {
        (
            uint256 newDeviationThresholdInPercentage,
            int224 newDeviationReference,
            uint256 newHeartbeatInterval
        ) = abi.decode(newUpdateParameters, (uint256, int224, uint256));
        (
            uint256 deviationThresholdInPercentage,
            int224 deviationReference,
            uint256 heartbeatInterval
        ) = abi.decode(updateParameters, (uint256, int224, uint256));
        if (
            endTimestamp <= block.timestamp && newEndTimestamp > block.timestamp
        ) {
            // A non-expired subscription is always an upgrade over an expired
            // subscription
            return true;
        }
        if (newDeviationReference != deviationReference) {
            // Two sets of parameters are incomparable, and thus we cannot call
            // this an upgrade
            return false;
        }
        if (
            newDeviationThresholdInPercentage > deviationThresholdInPercentage
        ) {
            return
                newHeartbeatInterval <= heartbeatInterval &&
                newEndTimestamp >= endTimestamp;
        } else if (newHeartbeatInterval < heartbeatInterval) {
            return
                newDeviationThresholdInPercentage <=
                deviationThresholdInPercentage &&
                newEndTimestamp >= endTimestamp;
        } else if (newEndTimestamp > endTimestamp) {
            return
                newDeviationThresholdInPercentage <=
                deviationThresholdInPercentage &&
                newHeartbeatInterval <= heartbeatInterval;
        }
        return false;
    }
}

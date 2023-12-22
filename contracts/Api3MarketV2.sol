// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./HashRegistryV2.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxyFactory.sol";
import "./AirseekerRegistry.sol";

contract Api3MarketV2 is HashRegistryV2 {
    enum UpdateParametersComparisonResult {
        EqualToQueued,
        BetterThanQueued,
        WorseThanQueued
    }

    struct Subscription {
        bytes32 updateParametersHash;
        uint32 endTimestamp;
        uint224 dailyPrice;
        bytes32 nextSubscriptionId;
    }

    // We allow a subscription queue of 5. We only need as many as the number
    // of tiers we have (currently 3: 1%, 0.5%, 0.25%).
    // As a note, there may be an off-by-one error here (in that the maximum
    // queue length is actually 4 or 6).
    uint256 public constant MAXIMUM_SUBSCRIPTION_QUEUE_LENGTH = 5;

    address public immutable api3ServerV1;

    address public immutable proxyFactory;

    address public immutable airseekerRegistry;

    // Keeping the subscriptions as a linked list
    mapping(bytes32 => Subscription) public subscriptions;

    // Where the subscription queue starts per dAPI name
    mapping(bytes32 => bytes32) public dapiNameToCurrentSubscriptionId;

    // There will be a very limited variety of update parameters so using their
    // hashes as a shorthand is a good optimization
    mapping(bytes32 => bytes) public updateParametersHashToValue;

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

    function buySubscription(
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
        addSubscriptionToQueue(
            dapiName,
            dataFeedId,
            updateParameters,
            duration,
            price
        );
        require(
            sponsorWallet.balance + msg.value >=
                computeExpectedSponsorWalletBalance(dapiName),
            "Insufficient payment"
        );
        // Emit event
        Address.sendValue(sponsorWallet, msg.value);
    }

    // For all active dAPIs, our bot should call this whenever it won't revert
    function flushSubscriptionQueue(
        bytes32 dapiName
    ) public returns (bytes32 currentSubscriptionId) {
        currentSubscriptionId = dapiNameToCurrentSubscriptionId[dapiName];
        require(currentSubscriptionId != bytes32(0), "dAPI inactive");
        require(
            subscriptions[currentSubscriptionId].endTimestamp <=
                block.timestamp,
            "Subscription has not ended"
        );
        // We flush the queue all the way until we have a subscription that has
        // not ended or the queue is empty. This is safe to do, as the queue
        // length is bounded by `MAXIMUM_SUBSCRIPTION_QUEUE_LENGTH`.
        while (true) {
            currentSubscriptionId = subscriptions[currentSubscriptionId]
                .nextSubscriptionId;
            if (
                currentSubscriptionId == bytes32(0) ||
                subscriptions[currentSubscriptionId].endTimestamp >
                block.timestamp
            ) {
                break;
            }
        }
        dapiNameToCurrentSubscriptionId[dapiName] = currentSubscriptionId;
        // Emit event
        if (currentSubscriptionId == bytes32(0)) {
            // Not reseting the dAPI name based on some discussions, though we
            // may want to change this later
            AirseekerRegistry(airseekerRegistry)
                .setDataFeedIdOrDapiNameToBeDeactivated(dapiName);
            AirseekerRegistry(airseekerRegistry)
                .setUpdateParametersWithDapiName(dapiName, "");
        } else {
            AirseekerRegistry(airseekerRegistry)
                .setUpdateParametersWithDapiName(
                    dapiName,
                    updateParametersHashToValue[
                        subscriptions[currentSubscriptionId]
                            .updateParametersHash
                    ]
                );
        }
    }

    // For all active dAPIs, our bot should call this whenever it won't revert.
    // It will have to multicall this with the respective
    // `updateBeaconWithSignedData()`, `updateBeaconSetWithBeacons()` and
    // `registerDataFeed()` calls.
    // Allowing this to be called even when the dAPI is not active, though we
    // may want to change this later.
    function updateDapiName(
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
        require(currentDataFeedId != dataFeedId, "Does not update dAPI name");
        validateDataFeedReadiness(dataFeedId);
        IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);
    }

    // For all active dAPIs, our bot should call this whenever it won't revert
    function updateSignedApiUrl(
        address airnode,
        string calldata signedApiUrl,
        bytes calldata signedApiUrlMerkleData
    ) external {
        verifySignedApiUrlMerkleProof(
            airnode,
            signedApiUrl,
            signedApiUrlMerkleData
        );
        require(
            keccak256(abi.encodePacked(signedApiUrl)) !=
                keccak256(
                    abi.encodePacked(
                        AirseekerRegistry(airseekerRegistry)
                            .airnodeToSignedApiUrl
                    )
                ),
            "Does not update signed API URL"
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

    function deployDapiProxyWithOev(
        bytes32 dapiName,
        address oevBeneficiary
    ) external returns (address proxyAddress) {
        proxyAddress = IProxyFactory(proxyFactory).deployDapiProxyWithOev(
            dapiName,
            oevBeneficiary,
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

    // This exposed for monitoring
    function computeExpectedSponsorWalletBalance(
        bytes32 dapiName
    ) public view returns (uint256 expectedSponsorWalletBalance) {
        bytes32 queuedSubscriptionId = dapiNameToCurrentSubscriptionId[
            dapiName
        ];
        uint32 startTimestamp = uint32(block.timestamp);
        while (true) {
            if (queuedSubscriptionId == bytes32(0)) {
                break;
            }
            Subscription storage queuedSubscription = subscriptions[
                queuedSubscriptionId
            ];
            // Skip if the queued subscription has ended
            if (queuedSubscription.endTimestamp > block.timestamp) {
                // `queuedSubscription.endTimestamp` is guaranteed to be larger
                // than `startTimestamp`
                expectedSponsorWalletBalance +=
                    ((queuedSubscription.endTimestamp - startTimestamp) *
                        queuedSubscription.dailyPrice) /
                    1 days;
            }
            startTimestamp = queuedSubscription.endTimestamp;
            queuedSubscriptionId = subscriptions[queuedSubscriptionId]
                .nextSubscriptionId;
        }
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
            AirseekerRegistry(airseekerRegistry).dataFeedIsRegistered(
                dataFeedId
            ),
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

    function addSubscriptionToQueue(
        bytes32 dapiName,
        bytes32 dataFeedId,
        bytes calldata updateParameters,
        uint256 duration,
        uint256 price
    ) private {
        (
            bytes32 subscriptionId,
            uint32 endTimestamp,
            bytes32 previousSubscriptionId,
            bytes32 nextSubscriptionId
        ) = prospectSubscriptionPositionInQueue(
                dapiName,
                updateParameters,
                duration
            );
        bytes32 updateParametersHash = keccak256(updateParameters);
        if (updateParametersHashToValue[updateParametersHash].length == 0) {
            updateParametersHashToValue[
                updateParametersHash
            ] = updateParameters;
        }
        subscriptions[subscriptionId] = Subscription({
            updateParametersHash: updateParametersHash,
            endTimestamp: endTimestamp,
            dailyPrice: uint224((price * duration) / 1 days),
            nextSubscriptionId: nextSubscriptionId
        });
        if (previousSubscriptionId == bytes32(0)) {
            dapiNameToCurrentSubscriptionId[dapiName] = subscriptionId;
            AirseekerRegistry(airseekerRegistry)
                .setUpdateParametersWithDapiName(dapiName, updateParameters);
            AirseekerRegistry(airseekerRegistry)
                .setDataFeedIdOrDapiNameToBeActivated(dapiName);
            // Let's not emit SetDapiName events for no reason
            bytes32 currentDataFeedId = IApi3ServerV1(api3ServerV1)
                .dapiNameHashToDataFeedId(
                    keccak256(abi.encodePacked(dapiName))
                );
            if (currentDataFeedId != dataFeedId) {
                validateDataFeedReadiness(dataFeedId);
                IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);
            }
        } else {
            subscriptions[previousSubscriptionId]
                .nextSubscriptionId = subscriptionId;
            // This next bit is optional but I don't see why not
            if (
                subscriptions[dapiNameToCurrentSubscriptionId[dapiName]]
                    .endTimestamp <= block.timestamp
            ) {
                flushSubscriptionQueue(dapiName);
            }
        }
    }

    function prospectSubscriptionPositionInQueue(
        bytes32 dapiName,
        bytes calldata updateParameters,
        uint256 duration
    )
        private
        view
        returns (
            bytes32 subscriptionId,
            uint32 endTimestamp,
            bytes32 previousSubscriptionId,
            bytes32 nextSubscriptionId
        )
    {
        subscriptionId = keccak256(
            abi.encodePacked(dapiName, keccak256(updateParameters))
        );
        endTimestamp = uint32(block.timestamp + duration);
        require(
            updateParameters.length == 96,
            "Invalid update parameters length"
        );
        (
            uint256 deviationThresholdInPercentage,
            int224 deviationReference,
            uint256 heartbeatInterval
        ) = abi.decode(updateParameters, (uint256, int224, uint256));
        bytes32 queuedSubscriptionId = dapiNameToCurrentSubscriptionId[
            dapiName
        ];
        // This function works correctly even when there are ended
        // subscriptions in the queue that need to be flushed. Its output
        // implicitly flushes them (only!) if the new subscription will be the
        // current one.
        uint256 ind = 0;
        for (; ind < MAXIMUM_SUBSCRIPTION_QUEUE_LENGTH; ind++) {
            if (queuedSubscriptionId == bytes32(0)) {
                // If the queue was empty, we immediately exit here, which
                // implies a single item queue consisting of the new
                // subscription.
                // Alternatively, we may have reached the end of the queue
                // before being able to find the `nextSubscriptionId`. This
                // means `nextSubscriptionId` will be `bytes32(0)`, i.e., the
                // new subscription gets appended to the end of the queue.
                break;
            }
            Subscription storage queuedSubscription = subscriptions[
                queuedSubscriptionId
            ];
            UpdateParametersComparisonResult updateParametersComparisonResult = compareUpdateParametersWithQueued(
                    deviationThresholdInPercentage,
                    deviationReference,
                    heartbeatInterval,
                    queuedSubscription.updateParametersHash
                );
            // The new subscription should be superior to every element in the
            // queue in one of the ways: It should have superior update
            // parameters, or it should have superior end timestamp. If it does
            // not, its addition to the queue does not improve it, which should
            // not be allowed.
            require(
                updateParametersComparisonResult ==
                    UpdateParametersComparisonResult.BetterThanQueued ||
                    endTimestamp > queuedSubscription.endTimestamp,
                "Subscription does not upgrade"
            );
            if (
                updateParametersComparisonResult ==
                UpdateParametersComparisonResult.WorseThanQueued &&
                queuedSubscription.endTimestamp > block.timestamp
            ) {
                // We do not check if the end timestamp is better than the
                // queued one because that is guaranteed (otherwise we would
                // have already reverted).
                // The previous subscription is one that is superior to the new
                // one. However, an ended subscription is always inferior to
                // one that has not ended. Therefore, we require the queued
                // subscription to not have ended to treat it as the previous
                // subscription. This effectively flushes the queue if the new
                // subscription turns out to be the current one.
                previousSubscriptionId = queuedSubscriptionId;
                // We keep updating `previousSubscriptionId` at each step, and
                // will stop being able to do that once we hit a subscription
                // that has equal to or worse update parameters. We can stop
                // looking for `previousSubscriptionId` after that point, but
                // doing so explicitly is unnecessarily complex, and this if
                // condition is cheap enough to evaluate redundantly.
            }
            if (
                updateParametersComparisonResult ==
                UpdateParametersComparisonResult.BetterThanQueued &&
                endTimestamp < queuedSubscription.endTimestamp
            ) {
                // In the queue, `previousSubscriptionId` comes before
                // `nextSubscriptionId`. Therefore, as soon as we find
                // `nextSubscriptionId`, we can break, as we know that we have
                // already found `previousSubscriptionId`.
                // This implicitly removes multiple sequential items from the
                // queue if they have inferior update parameters and end
                // timestamps than the new subscription, somewhat similar to
                // the implicit flushing mentioned above.
                nextSubscriptionId = queuedSubscriptionId;
                break;
            }
            queuedSubscriptionId = queuedSubscription.nextSubscriptionId;
        }
        // If we exited the loop before hitting any breaks, our
        // `nextSubscriptionId` is potentially wrong and we should revert. If
        // the queue is congested by ended subscriptions, flushing them
        // beforehand would have helped here.
        require(
            ind != MAXIMUM_SUBSCRIPTION_QUEUE_LENGTH,
            "Subscription queue full"
        );
    }

    function compareUpdateParametersWithQueued(
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint256 heartbeatInterval,
        bytes32 queuedUpdateParametersHash
    ) private view returns (UpdateParametersComparisonResult) {
        // If update parameters are already queued, they are guaranteed to have
        // been stored in `updateParametersHashToValue`
        (
            uint256 queuedDeviationThresholdInPercentage,
            int224 queuedDeviationReference,
            uint256 queuedHeartbeatInterval
        ) = abi.decode(
                updateParametersHashToValue[queuedUpdateParametersHash],
                (uint256, int224, uint256)
            );
        require(
            deviationReference == queuedDeviationReference,
            "Deviation references not equal"
        );
        if (
            (deviationThresholdInPercentage ==
                queuedDeviationThresholdInPercentage) &&
            (heartbeatInterval == queuedHeartbeatInterval)
        ) {
            return UpdateParametersComparisonResult.EqualToQueued;
        } else if (
            (deviationThresholdInPercentage <=
                queuedDeviationThresholdInPercentage) &&
            (heartbeatInterval <= queuedHeartbeatInterval)
        ) {
            return UpdateParametersComparisonResult.BetterThanQueued;
        } else if (
            (deviationThresholdInPercentage >=
                queuedDeviationThresholdInPercentage) &&
            (heartbeatInterval >= queuedHeartbeatInterval)
        ) {
            return UpdateParametersComparisonResult.WorseThanQueued;
        } else {
            // This is hit when one set of parameters have better deviation
            // threshold and the other has better heartbeat interval
            revert("Update parameters incomparable");
        }
    }
}

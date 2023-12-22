// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@api3/airnode-protocol-v1/contracts/utils/ExtendedSelfMulticall.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";

contract AirseekerRegistry is Ownable, ExtendedSelfMulticall {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    event ActivatedDataFeedIdOrDapiName(bytes32 indexed dataFeedIdOrDapiName);

    event DeactivatedDataFeedIdOrDapiName(bytes32 indexed dataFeedIdOrDapiName);

    event UpdatedUpdateParametersWithDataFeedId(
        bytes32 indexed dataFeedId,
        bytes updateParameters
    );

    event UpdatedUpdateParametersWithDapiName(
        bytes32 indexed dapiName,
        bytes updateParameters
    );

    event UpdatedSignedApiUrl(address indexed airnode, string signedApiUrl);

    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedDetails);

    address public immutable api3ServerV1;

    mapping(address => string) public airnodeToSignedApiUrl;

    mapping(bytes32 => bytes) public dataFeedIdToDetails;

    mapping(bytes32 => bytes32)
        private dataFeedIdOrDapiNameHashToUpdateParametersHash;

    mapping(bytes32 => bytes) private updateParametersHashToValue;

    EnumerableSet.Bytes32Set private activeDataFeedIdsAndDapiNames;

    // The length of abi.encode(address,bytes32)
    uint256 private constant DATA_FEED_DETAILS_LENGTH_FOR_SINGLE_BEACON =
        32 + 32;

    uint256
        private constant DATA_FEED_DETAILS_LENGTH_FOR_BEACON_SET_WITH_TWO_BEACONS =
        (2 * 32) + (32 + 2 * 32) + (32 + 2 * 32);

    uint256 private constant MAXIMUM_BEACON_COUNT_IN_SET = 21;

    // The length of abi.encode(address[],bytes32[]), where each array has
    // MAXIMUM_BEACON_COUNT_IN_SET items
    uint256 private constant MAXIMUM_DATA_FEED_DETAILS_LENGTH =
        (2 * 32) +
            (32 + MAXIMUM_BEACON_COUNT_IN_SET * 32) +
            (32 + MAXIMUM_BEACON_COUNT_IN_SET * 32);

    modifier onlyNonZeroDataFeedIdOrDapiName(bytes32 dataFeedIdOrDapiName) {
        require(
            dataFeedIdOrDapiName != bytes32(0),
            "dAPI name or data feed ID zero"
        );
        _;
    }

    constructor(address api3ServerV1_) {
        require(api3ServerV1_ != address(0), "Api3ServerV1 address zero");
        api3ServerV1 = api3ServerV1_;
    }

    function setDataFeedIdOrDapiNameToBeActivated(
        bytes32 dataFeedIdOrDapiName
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedIdOrDapiName) {
        if (activeDataFeedIdsAndDapiNames.add(dataFeedIdOrDapiName)) {
            emit ActivatedDataFeedIdOrDapiName(dataFeedIdOrDapiName);
        }
    }

    function setDataFeedIdOrDapiNameToBeDeactivated(
        bytes32 dataFeedIdOrDapiName
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedIdOrDapiName) {
        if (activeDataFeedIdsAndDapiNames.remove(dataFeedIdOrDapiName)) {
            emit DeactivatedDataFeedIdOrDapiName(dataFeedIdOrDapiName);
        }
    }

    function setUpdateParametersWithDataFeedId(
        bytes32 dataFeedId,
        bytes calldata updateParameters
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedId) {
        bytes32 updateParametersHash = keccak256(updateParameters);
        if (
            dataFeedIdOrDapiNameHashToUpdateParametersHash[dataFeedId] !=
            updateParametersHash
        ) {
            dataFeedIdOrDapiNameHashToUpdateParametersHash[
                dataFeedId
            ] = updateParametersHash;
            if (
                keccak256(updateParametersHashToValue[updateParametersHash]) !=
                updateParametersHash
            ) {
                updateParametersHashToValue[
                    updateParametersHash
                ] = updateParameters;
            }
            emit UpdatedUpdateParametersWithDataFeedId(
                dataFeedId,
                updateParameters
            );
        }
    }

    function setUpdateParametersWithDapiName(
        bytes32 dapiName,
        bytes calldata updateParameters
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dapiName) {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        bytes32 updateParametersHash = keccak256(updateParameters);
        if (
            dataFeedIdOrDapiNameHashToUpdateParametersHash[dapiNameHash] !=
            updateParametersHash
        ) {
            dataFeedIdOrDapiNameHashToUpdateParametersHash[
                dapiNameHash
            ] = updateParametersHash;
            if (
                keccak256(updateParametersHashToValue[updateParametersHash]) !=
                updateParametersHash
            ) {
                updateParametersHashToValue[
                    updateParametersHash
                ] = updateParameters;
            }
            emit UpdatedUpdateParametersWithDapiName(
                dapiName,
                updateParameters
            );
        }
    }

    function setSignedApiUrl(
        address airnode,
        string calldata signedApiUrl
    ) external onlyOwner {
        require(airnode != address(0), "Airnode address zero");
        require(
            abi.encodePacked(signedApiUrl).length <= 256,
            "Signed API URL too long"
        );
        if (
            keccak256(bytes(airnodeToSignedApiUrl[airnode])) !=
            keccak256(bytes(signedApiUrl))
        ) {
            airnodeToSignedApiUrl[airnode] = signedApiUrl;
            emit UpdatedSignedApiUrl(airnode, signedApiUrl);
        }
    }

    function registerDataFeed(
        bytes calldata dataFeedDetails
    ) external returns (bytes32 dataFeedId) {
        uint256 dataFeedDetailsLength = dataFeedDetails.length;
        if (
            dataFeedDetailsLength == DATA_FEED_DETAILS_LENGTH_FOR_SINGLE_BEACON
        ) {
            // dataFeedId maps to a Beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeedDetails,
                (address, bytes32)
            );
            dataFeedId = deriveBeaconId(airnode, templateId);
        } else if (
            dataFeedDetailsLength >=
            DATA_FEED_DETAILS_LENGTH_FOR_BEACON_SET_WITH_TWO_BEACONS
        ) {
            // dataFeedId maps to a Beacon set with at least two Beacons.
            require(
                dataFeedDetailsLength <= MAXIMUM_DATA_FEED_DETAILS_LENGTH,
                "Feed details data too long"
            );
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeedDetails, (address[], bytes32[]));
            require(
                abi.encode(airnodes, templateIds).length ==
                    dataFeedDetailsLength,
                "Feed details data trail"
            );
            require(
                airnodes.length == templateIds.length,
                "Parameter length mismatch"
            );
            uint256 beaconCount = airnodes.length;
            bytes32[] memory beaconIds = new bytes32[](beaconCount);
            for (uint256 ind = 0; ind < beaconCount; ind++) {
                beaconIds[ind] = deriveBeaconId(
                    airnodes[ind],
                    templateIds[ind]
                );
            }
            dataFeedId = deriveBeaconSetId(beaconIds);
        } else {
            revert("Details data too short");
        }
        if (
            keccak256(dataFeedIdToDetails[dataFeedId]) !=
            keccak256(dataFeedDetails)
        ) {
            dataFeedIdToDetails[dataFeedId] = dataFeedDetails;
            emit RegisteredDataFeed(dataFeedId, dataFeedDetails);
        }
    }

    // If the index exceeds the boundaries of the data feed enumeration, all
    // return parameters will be zero/empty.
    // If the respective data feed is not registered, all return parameters
    // will be zero/empty.
    // If the respective data feed is identified by a data feed ID and not a
    // dAPI name, `dapiName` will be zero as an indication of that fact.
    function activeDataFeed(
        uint256 index
    )
        external
        view
        returns (
            bytes32 dapiName,
            bytes memory dataFeedDetails,
            int224 dataFeedValue,
            uint32 dataFeedTimestamp,
            bytes memory updateParameters,
            string[] memory signedApiUrls
        )
    {
        if (index < activeDataFeedIdsAndDapiNames.length()) {
            bytes32 dataFeedIdOrDapiName = activeDataFeedIdsAndDapiNames.at(
                index
            );
            // Start by guessing that `dataFeedIdOrDapiName` is the ID of a
            // registered data feed
            bytes32 dataFeedId = dataFeedIdOrDapiName;
            dataFeedDetails = dataFeedIdToDetails[dataFeedId];
            uint256 dataFeedDetailsLength = dataFeedDetails.length;
            if (dataFeedDetailsLength == 0) {
                // `dataFeedIdOrDapiName` is not the ID of a registered data
                // feed. Check if it is the name of a dAPI that points to a
                // registered data feed.
                dataFeedId = IApi3ServerV1(api3ServerV1)
                    .dapiNameHashToDataFeedId(
                        keccak256(abi.encodePacked(dataFeedIdOrDapiName))
                    );
                dataFeedDetails = dataFeedIdToDetails[dataFeedId];
                dataFeedDetailsLength = dataFeedDetails.length;
                if (dataFeedDetailsLength != 0) {
                    // Confirmed that `dataFeedIdOrDapiName` is the name of a
                    // dAPI that points to a registered data feed
                    dapiName = dataFeedIdOrDapiName;
                }
            }
            if (dataFeedDetailsLength != 0) {
                (dataFeedValue, dataFeedTimestamp) = IApi3ServerV1(api3ServerV1)
                    .dataFeeds(dataFeedId);
                if (dapiName == bytes32(0)) {
                    updateParameters = updateParametersHashToValue[
                        dataFeedIdOrDapiNameHashToUpdateParametersHash[
                            dataFeedIdOrDapiName
                        ]
                    ];
                } else {
                    updateParameters = updateParametersHashToValue[
                        dataFeedIdOrDapiNameHashToUpdateParametersHash[
                            keccak256(abi.encodePacked(dataFeedIdOrDapiName))
                        ]
                    ];
                }
                if (
                    dataFeedDetails.length ==
                    DATA_FEED_DETAILS_LENGTH_FOR_SINGLE_BEACON
                ) {
                    signedApiUrls = new string[](1);
                    signedApiUrls[0] = airnodeToSignedApiUrl[
                        abi.decode(dataFeedDetails, (address))
                    ];
                } else {
                    address[] memory airnodes = abi.decode(
                        dataFeedDetails,
                        (address[])
                    );
                    uint256 beaconCount = airnodes.length;
                    signedApiUrls = new string[](beaconCount);
                    for (uint256 ind = 0; ind < beaconCount; ind++) {
                        signedApiUrls[ind] = airnodeToSignedApiUrl[
                            airnodes[ind]
                        ];
                    }
                }
            }
        }
    }

    function activeDataFeedCount() external view returns (uint256) {
        return activeDataFeedIdsAndDapiNames.length();
    }

    function dataFeedIdOrDapiNameHashToUpdateParameters(
        bytes32 dataFeedIdOrDapiNameHash
    ) external view returns (bytes memory updateParameters) {
        updateParameters = updateParametersHashToValue[
            dataFeedIdOrDapiNameHashToUpdateParametersHash[
                dataFeedIdOrDapiNameHash
            ]
        ];
    }

    function dataFeedIsRegistered(
        bytes32 dataFeedId
    ) external view returns (bool) {
        return dataFeedIdToDetails[dataFeedId].length != 0;
    }

    // `activeDataFeed()` does not return data when the data feed is not
    // registered. This function is implemented as a workaround to find out
    // what the active yet unregistered feeds are.
    function activeDataFeedIdOrDapiName(
        uint256 index
    ) external view returns (bytes32) {
        if (index < activeDataFeedIdsAndDapiNames.length()) {
            return activeDataFeedIdsAndDapiNames.at(index);
        }
        return bytes32(0);
    }

    function deriveBeaconId(
        address airnode,
        bytes32 templateId
    ) private pure returns (bytes32 beaconId) {
        beaconId = keccak256(abi.encodePacked(airnode, templateId));
    }

    function deriveBeaconSetId(
        bytes32[] memory beaconIds
    ) private pure returns (bytes32 beaconSetId) {
        beaconSetId = keccak256(abi.encode(beaconIds));
    }
}

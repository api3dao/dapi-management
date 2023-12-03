// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";

contract AirseekerRegistry is Ownable, SelfMulticall {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using ECDSA for bytes32;

    struct SignedApiUrl {
        string value;
        uint256 timestamp;
    }

    struct DataFeedReading {
        int224 value;
        uint32 timestamp;
    }

    event ActivatedDataFeedIdOrDapiName(bytes32 indexed dataFeedIdOrDapiName);

    event DeactivatedDataFeedIdOrDapiName(bytes32 indexed dataFeedIdOrDapiName);

    event SetUpdateParameters(
        bytes32 indexed dataFeedIdOrDapiName,
        bytes updateParameters
    );

    event SetSignedApiUrl(
        address indexed airnode,
        string signedApiUrl,
        uint256 timestamp
    );

    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedDetails);

    address public immutable api3ServerV1;

    mapping(bytes32 => bytes) public dataFeedIdOrDapiNameToUpdateParameters;

    mapping(address => SignedApiUrl) public airnodeToSignedApiUrl;

    mapping(bytes32 => bytes) public dataFeedIdToDetails;

    bytes32 private constant SIGNED_API_URL_SALT =
        keccak256(abi.encodePacked("Signed API URL"));

    EnumerableSet.Bytes32Set private activeDataFeedIdsAndDapiNames;

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

    function activateDataFeedIdOrDapiName(
        bytes32 dataFeedIdOrDapiName
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedIdOrDapiName) {
        activeDataFeedIdsAndDapiNames.add(dataFeedIdOrDapiName);
        emit ActivatedDataFeedIdOrDapiName(dataFeedIdOrDapiName);
    }

    function deactivateDataFeedIdOrDapiName(
        bytes32 dataFeedIdOrDapiName
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedIdOrDapiName) {
        activeDataFeedIdsAndDapiNames.remove(dataFeedIdOrDapiName);
        emit DeactivatedDataFeedIdOrDapiName(dataFeedIdOrDapiName);
    }

    function setUpdateParameters(
        bytes32 dataFeedIdOrDapiName,
        bytes calldata updateParameters
    ) external onlyOwner onlyNonZeroDataFeedIdOrDapiName(dataFeedIdOrDapiName) {
        dataFeedIdOrDapiNameToUpdateParameters[
            dataFeedIdOrDapiName
        ] = updateParameters;
        emit SetUpdateParameters(dataFeedIdOrDapiName, updateParameters);
    }

    function setSignedApiUrl(
        address airnode,
        string calldata signedApiUrl,
        uint256 timestamp,
        bytes calldata signature
    ) external {
        require(
            abi.encodePacked(signedApiUrl).length <= 256,
            "Signed API URL too long"
        );
        require(
            (
                keccak256(
                    abi.encode(SIGNED_API_URL_SALT, signedApiUrl, timestamp)
                ).toEthSignedMessageHash()
            ).recover(signature) == airnode,
            "Signature mismatch"
        );
        require(
            timestamp > airnodeToSignedApiUrl[airnode].timestamp,
            "Timestamp not more recent"
        );
        airnodeToSignedApiUrl[airnode] = SignedApiUrl({
            value: signedApiUrl,
            timestamp: timestamp
        });
        emit SetSignedApiUrl(airnode, signedApiUrl, timestamp);
    }

    function registerDataFeed(
        bytes calldata dataFeedDetails
    ) external returns (bytes32 dataFeedId) {
        uint256 dataFeedDetailsLength = dataFeedDetails.length;
        if (dataFeedDetailsLength == 64) {
            // dataFeedId maps to a Beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeedDetails,
                (address, bytes32)
            );
            dataFeedId = deriveBeaconId(airnode, templateId);
        } else if (dataFeedDetailsLength >= 256) {
            // dataFeedId maps to a Beacon set with at least two Beacons
            // Do not allow more than 21 Beacons
            require(dataFeedDetailsLength < 2816, "Details data too long");
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeedDetails, (address[], bytes32[]));
            require(
                abi.encode(airnodes, templateIds).length ==
                    dataFeedDetailsLength,
                "Trailing data"
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

    function activeDataFeedWithIndex(
        uint256 index
    )
        external
        view
        returns (
            bytes32 dapiName,
            bytes memory dataFeedDetails,
            DataFeedReading memory dataFeedReading,
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
                    // `dataFeedIdOrDapiName` is the name of a dAPI that points
                    // to a registered data feed
                    dapiName = dataFeedIdOrDapiName;
                }
            }
            if (dataFeedDetailsLength != 0) {
                (int224 value, uint32 timestamp) = IApi3ServerV1(api3ServerV1)
                    .dataFeeds(dataFeedId);
                dataFeedReading = DataFeedReading({
                    value: value,
                    timestamp: timestamp
                });
                updateParameters = dataFeedIdOrDapiNameToUpdateParameters[
                    dataFeedIdOrDapiName
                ];
                if (dataFeedDetails.length == 64) {
                    address airnode = abi.decode(dataFeedDetails, (address));
                    signedApiUrls = new string[](1);
                    signedApiUrls[0] = airnodeToSignedApiUrl[airnode].value;
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
                        ].value;
                    }
                }
            }
        }
    }

    function activeDataFeedCount() external view returns (uint256) {
        return activeDataFeedIdsAndDapiNames.length();
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

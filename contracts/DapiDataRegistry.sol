// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/ITimestampedHashRegistry.sol";

import "hardhat/console.sol";

contract DapiDataRegistry is
    SelfMulticall,
    AccessControlRegistryAdminnedWithManager
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Register data role description
    // string public constant override REGISTER_DATA_ROLE_DESCRIPTION = "dAPI data setter role";
    string public constant REGISTER_DATA_ROLE_DESCRIPTION =
        "Register dAPI data role";

    /// @notice Register dAPI data role
    // bytes32 public immutable override registerDataRole;
    bytes32 public immutable registerDataRole;

    modifier onlyRegisterDataRole() {
        require(
            msg.sender == manager ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    registerDataRole,
                    msg.sender
                ),
            "Sender is not manager or needs role"
        );
        _;
    }

    // ITimestampedHashRegistry public immutable override timestampedHashRegistry;
    ITimestampedHashRegistry public immutable timestampedHashRegistry;
    // IApi3ServerV1 public immutable override api3ServerV1;
    IApi3ServerV1 public immutable api3ServerV1;

    event RegisteredSignedApiUrl(
        address indexed airnode,
        bytes32 oisTitle,
        string url
    );
    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedData);
    event RegisteredDapi(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet,
        uint256 deviationThreshold,
        uint256 heartbeatInterval
    );

    struct Beacon {
        address airnode;
        bytes32 templateId;
    }
    struct SignedApi {
        bytes32 oisTitle;
        string url;
    }
    // TODO: use uint128 to pack both in a single 32 bytes slot?
    struct UpdateParameters {
        uint256 deviationThreshold;
        uint256 heartbeatInterval;
        // int224 deviationReference; Currently not used by Airseeker v1
    }

    // This is updated using the API management merkle tree
    mapping(address => SignedApi) airnodeToSignedApi;

    // The value should be a single value or an array of them
    // This needs to be encoded so we can determine if it's a beacon
    // or a beaconSet based on the lenght
    // It can be udpated by anyone because the contract will hash the data and derive it
    // Airseeker will need to multicall to read all data using a single RPC call
    mapping(bytes32 => bytes) dataFeedIdToDataFeedData;

    // This is the list of dAPIs AirseekerV2 will need to update
    // Api3Market contract will have a role to update this after a purchase
    EnumerableSet.Bytes32Set private activeDapis;

    mapping(bytes32 => UpdateParameters) private dapiToUpdateParameters;

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        ITimestampedHashRegistry _timestampedHashRegistry,
        IApi3ServerV1 _api3ServerV1
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        registerDataRole = _deriveRole(
            _deriveAdminRole(manager),
            REGISTER_DATA_ROLE_DESCRIPTION
        );
        timestampedHashRegistry = _timestampedHashRegistry;
        api3ServerV1 = _api3ServerV1;
    }

    function registerAirnodeSignedApiUrl(
        bytes32 hashType,
        address airnode,
        bytes32 oisTitle,
        string calldata url,
        bytes32 root,
        bytes32[] calldata proof
    ) external onlyRegisterDataRole {
        // Check root exists in TimestampedHashRegistry
        require(
            timestampedHashRegistry.hashTypeToHash(hashType) == root,
            "Invalid root"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(airnode, oisTitle, url)))
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        airnodeToSignedApi[airnode] = SignedApi(oisTitle, url);

        emit RegisteredSignedApiUrl(airnode, oisTitle, url);
    }

    // TODO1: Should anyone really be able to call this?
    // TODO2: Wouldn't it be simpler to register using an array of Beacon[]?
    //        It would have a single element when beacon and multiple when beaconSet
    function registerDatafeed(
        bytes calldata dataFeedData
    ) external returns (bytes32 dataFeedId) {
        require(dataFeedData.length > 0, "Data feed data is empty");
        // console.log(dataFeedData.length);
        if (dataFeedData.length == 64) {
            // DataFeedId maps to a beacon
            Beacon memory beacon = abi.decode(dataFeedData, (Beacon));
            // console.log(beacon.airnode);
            // console.logBytes32(beacon.templateId);
            // Derive beacon ID
            dataFeedId = keccak256(
                abi.encode(beacon.airnode, beacon.templateId)
            );
        } else {
            // DataFeedId maps to a beaconSet
            bytes[] memory beacons = abi.decode(dataFeedData, (bytes[]));
            bytes32[] memory beaconIds = new bytes32[](beacons.length);
            for (uint256 ind = 0; ind < beacons.length; ind++) {
                Beacon memory beacon = abi.decode(beacons[ind], (Beacon));
                // console.log(beacon.airnode);
                // console.logBytes32(beacon.templateId);
                // Derive beacon ID
                beaconIds[ind] = keccak256(
                    abi.encode(beacon.airnode, beacon.templateId)
                );
            }
            // Derive beacon set ID
            dataFeedId = keccak256(abi.encode(beaconIds));
        }

        dataFeedIdToDataFeedData[dataFeedId] = dataFeedData;

        emit RegisteredDataFeed(dataFeedId, dataFeedData);
    }

    function registerDapi(
        bytes32 hashType,
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThreshold,
        uint256 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external onlyRegisterDataRole {
        // TODO: add more checks

        // Check datafeedId has been registered
        require(
            dataFeedIdToDataFeedData[dataFeedId].length > 0,
            "dataFeedId has not been registered"
        );

        // Check root exists in TimestampedHashRegistry
        require(
            timestampedHashRegistry.hashTypeToHash(hashType) == root,
            "Invalid root"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, dataFeedId, sponsorWallet))
            )
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));

        // TODO: do we also need a dapiNameHashToDapiName mapping?
        //       or refactor UpdateParameters to also include dapiName?
        activeDapis.add(dapiNameHash);
        dapiToUpdateParameters[dapiNameHash] = UpdateParameters(
            deviationThreshold,
            heartbeatInterval
        );

        // Set dapiName to dataFeedId (this contract needs to be granted the dapi name setter role)
        api3ServerV1.setDapiName(dapiName, dataFeedId);

        emit RegisteredDapi(
            dapiName,
            dataFeedId,
            sponsorWallet,
            deviationThreshold,
            heartbeatInterval
        );
    }

    function removeDapi(bytes32 dapiName) external {
        require(dapiName != bytes32(0), "dAPI name is empty");
        require(activeDapis.contains(dapiName), "dAPI name is not registered");
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        activeDapis.remove(dapiNameHash);
        delete dapiToUpdateParameters[dapiNameHash];
    }

    function registeredDapisCount() public view returns (uint256 count) {
        count = activeDapis.length();
    }

    function readDapis(
        uint256 offset,
        uint256 limit
    )
        external
        view
        returns (
            bytes32[] memory dapiNameHashes,
            bytes32[] memory dataFeedIds,
            UpdateParameters[] memory updateParameters
        )
    {
        uint256 count = registeredDapisCount();
        require(offset < count, "Invalid offset");
        uint256 limitAdjusted = offset + limit > count ? count - offset : limit;
        dapiNameHashes = new bytes32[](limitAdjusted);
        dataFeedIds = new bytes32[](limitAdjusted);
        updateParameters = new UpdateParameters[](limitAdjusted);
        for (uint256 ind = 0; ind < offset + limitAdjusted; ind++) {
            bytes32 dapiNameHash = activeDapis.at(ind);
            dapiNameHashes[ind] = dapiNameHash;
            dataFeedIds[ind] = api3ServerV1.dapiNameHashToDataFeedId(
                dapiNameHash
            );
            updateParameters[ind] = dapiToUpdateParameters[dapiNameHash];
        }
        // TODO: should this function also return the Signed API URLs for each Airnode in the UpdateParameters?
    }
}

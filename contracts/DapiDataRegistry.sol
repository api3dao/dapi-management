// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@api3/airnode-protocol-v1/contracts/utils/SelfMulticall.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IHashRegistry.sol";

import "hardhat/console.sol";

contract DapiDataRegistry is
    SelfMulticall,
    AccessControlRegistryAdminnedWithManager
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Number that represents 100%
    // uint256 public constant override HUNDRED_PERCENT = 1e8;
    uint256 public constant HUNDRED_PERCENT = 1e8;

    // string public constant PRICE_MANAGEMENT_HASH_TYPE_DESCRIPTION =
    //     "Price management merkle tree root";
    string public constant DAPI_MANAGEMENT_HASH_TYPE_DESCRIPTION =
        "dAPI management merkle tree root";
    string public constant API_INTEGRATION_HASH_TYPE_DESCRIPTION =
        "API integration merkle tree root";

    // bytes32 private constant _PRICE_MANAGEMENT_HASH_TYPE =
    //     keccak256(abi.encodePacked(PRICE_MANAGEMENT_HASH_TYPE_DESCRIPTION));
    bytes32 private constant _DAPI_MANAGEMENT_HASH_TYPE =
        keccak256(abi.encodePacked(DAPI_MANAGEMENT_HASH_TYPE_DESCRIPTION));
    bytes32 private constant _API_INTEGRATION_HASH_TYPE =
        keccak256(abi.encodePacked(API_INTEGRATION_HASH_TYPE_DESCRIPTION));

    /// @notice Registrar role description
    // string public constant override REGISTRAR_ROLE_DESCRIPTION = "Registrar";
    string public constant REGISTRAR_ROLE_DESCRIPTION = "Registrar";

    /// @notice Registrar role
    // bytes32 public immutable override registrarRole;
    bytes32 public immutable registrarRole;

    // IHashRegistry public immutable override hashRegistry;
    IHashRegistry public immutable hashRegistry;
    // IApi3ServerV1 public immutable override api3ServerV1;
    IApi3ServerV1 public immutable api3ServerV1;

    event RegisteredSignedApiUrl(address indexed airnode, string url);
    event UnregisteredSignedApiUrl(address indexed airnode);
    event RegisteredDataFeed(bytes32 indexed dataFeedId, bytes dataFeedData);
    event RegisteredDapi(
        bytes32 indexed dapiName,
        bytes32 indexed dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval
    );
    event UnregisteredDapi(bytes32 indexed dapiName);

    struct UpdateParameters {
        uint256 deviationThresholdInPercentage;
        int224 deviationReference;
        uint32 heartbeatInterval;
    }

    // This is updated using the API management merkle tree
    mapping(address => string) public airnodeToSignedApiUrl;

    // The value should be a single value or an array of them
    // This needs to be encoded so we can determine if it's a beacon
    // or a beaconSet based on the lenght
    // It can be udpated by anyone because the contract will hash the data and derive it
    // Airseeker will need to multicall to read all data using a single RPC call
    mapping(bytes32 => bytes) public dataFeedIdToData;

    // This is the list of dAPIs AirseekerV2 will need to update
    // Api3Market contract will have a role to update this after a purchase
    // Dapi names are expected to be unique bytes32 strings
    EnumerableSet.Bytes32Set private activeDapis;

    mapping(bytes32 => UpdateParameters) private dapiNameHashToUpdateParameters;

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        IHashRegistry _hashRegistry,
        IApi3ServerV1 _api3ServerV1
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        registrarRole = _deriveRole(
            _deriveAdminRole(manager),
            REGISTRAR_ROLE_DESCRIPTION
        );
        hashRegistry = _hashRegistry;
        api3ServerV1 = _api3ServerV1;
    }

    /// @dev Returns if the account has the Registrar role or is the manager
    /// @param account Account address
    /// @return If the account has the Registrar role or is the manager
    function hasRegistrarRoleOrIsManager(
        address account
    ) internal view returns (bool) {
        return
            manager == account ||
            IAccessControlRegistry(accessControlRegistry).hasRole(
                registrarRole,
                account
            );
    }

    function registerAirnodeSignedApiUrl(
        address airnode,
        string calldata url,
        bytes32 root,
        bytes32[] calldata proof
    ) external {
        require(root != bytes32(0), "Root zero");
        require(proof.length != 0, "Proof empty");
        // Check root exists in HashRegistry
        require(
            hashRegistry.hashTypeToHash(_API_INTEGRATION_HASH_TYPE) == root,
            "Invalid root"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(airnode, url)))
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        airnodeToSignedApiUrl[airnode] = url;

        emit RegisteredSignedApiUrl(airnode, url);
    }

    function unregisterAirnodeSignedApiUrl(address airnode) external {
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        require(airnode != address(0));
        airnodeToSignedApiUrl[airnode] = "";

        emit UnregisteredSignedApiUrl(airnode); // TODO: add msg.sender?
    }

    function registerDataFeed(
        bytes calldata dataFeedData
    ) external returns (bytes32 dataFeedId) {
        require(dataFeedData.length > 0, "Data feed data is empty");
        if (dataFeedData.length == 64) {
            // DataFeedId maps to a beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeedData,
                (address, bytes32)
            );
            // Derive beacon ID
            // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L87
            dataFeedId = keccak256(abi.encodePacked(airnode, templateId));
        } else {
            // DataFeedId maps to a beaconSet
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeedData, (address[], bytes32[]));
            require(airnodes.length == templateIds.length, "Length mismatch");
            bytes32[] memory beaconIds = new bytes32[](airnodes.length);
            for (uint256 ind = 0; ind < airnodes.length; ind++) {
                // Derive beacon ID
                // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L87
                beaconIds[ind] = keccak256(
                    abi.encodePacked(airnodes[ind], templateIds[ind])
                );
            }
            // Derive beacon set ID
            // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L98
            dataFeedId = keccak256(abi.encode(beaconIds));
        }

        dataFeedIdToData[dataFeedId] = dataFeedData;

        emit RegisteredDataFeed(dataFeedId, dataFeedData);
    }

    function registerDapi(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        uint256 deviationThresholdInPercentage,
        int224 deviationReference,
        uint32 heartbeatInterval,
        bytes32 root,
        bytes32[] calldata proof
    ) external {
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        require(root != bytes32(0), "Root zero");
        require(proof.length != 0, "Proof empty");
        // Check root exists in HashRegistry
        require(
            hashRegistry.hashTypeToHash(_DAPI_MANAGEMENT_HASH_TYPE) == root,
            "Invalid root"
        );
        // Check dataFeedId has been registered
        require(
            dataFeedIdToData[dataFeedId].length > 0,
            "dataFeedId has not been registered"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, dataFeedId, sponsorWallet))
            )
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        activeDapis.add(dapiName); // TODO: Not checking if already exists in set to allow for update parameters override
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        dapiNameHashToUpdateParameters[dapiNameHash] = UpdateParameters(
            deviationThresholdInPercentage, // TODO: can this be 0? should we check against any low/high boundary based on HUNDRED_PERCENT constant?
            deviationReference,
            heartbeatInterval // TODO: can this be 0?
        );

        // Set dapiName to dataFeedId (this contract needs to be granted the dapi name setter role)
        api3ServerV1.setDapiName(dapiName, dataFeedId);

        emit RegisteredDapi(
            dapiName,
            dataFeedId,
            sponsorWallet,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval
        );
    }

    function unregisterDapi(bytes32 dapiName) external {
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        require(dapiName != bytes32(0), "dAPI name is empty");
        require(activeDapis.remove(dapiName), "dAPI name is not registered");
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        delete dapiNameHashToUpdateParameters[dapiNameHash];

        emit UnregisteredDapi(dapiName); // TODO: add msg.sender?
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
            bytes32[] memory dapiNames,
            bytes32[] memory dataFeedIds,
            UpdateParameters[] memory updateParameters,
            bytes[] memory dataFeedDatas
        )
    {
        uint256 count = registeredDapisCount();
        require(offset < count, "Invalid offset");
        uint256 limitAdjusted = offset + limit > count ? count - offset : limit;
        dapiNames = new bytes32[](limitAdjusted);
        dataFeedIds = new bytes32[](limitAdjusted);
        dataFeedDatas = new bytes[](limitAdjusted);
        updateParameters = new UpdateParameters[](limitAdjusted);
        for (uint256 ind = 0; ind < offset + limitAdjusted; ind++) {
            bytes32 dapiName = activeDapis.at(ind);
            dapiNames[ind] = dapiName;
            bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
            bytes32 dataFeedId = api3ServerV1.dapiNameHashToDataFeedId(
                dapiNameHash
            );
            dataFeedIds[ind] = dataFeedId;
            updateParameters[ind] = dapiNameHashToUpdateParameters[
                dapiNameHash
            ];
            dataFeedDatas[ind] = dataFeedIdToData[dataFeedId];
        }
    }
}

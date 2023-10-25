// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IDapiDataRegistry.sol";
import "./interfaces/IHashRegistry.sol";

contract DapiDataRegistry is
    AccessControlRegistryAdminnedWithManager,
    IDapiDataRegistry
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice Number that represents 100%
    uint256 public constant override HUNDRED_PERCENT = 1e8;

    // dAPI management merkle tree root
    bytes32 public constant override DAPI_MANAGEMENT_HASH_TYPE =
        0x712570292038af5b32abe8cf88dee0abd7dcd5dd759c6f133dd781e3a0f7e53d;
    // API integration merkle tree root
    bytes32 public constant override API_INTEGRATION_HASH_TYPE =
        0xf607eab1a0e1d5843e97cc3768147f5f15420188755ebc3a685ddcefe6d79d63;

    /// @notice Registrar role description
    string public constant override REGISTRAR_ROLE_DESCRIPTION = "Registrar";

    /// @notice Registrar role
    bytes32 public immutable override registrarRole;

    IHashRegistry public immutable override hashRegistry;
    IApi3ServerV1 public immutable override api3ServerV1;

    // This is updated using the API management merkle tree
    // TODO: should this mapping be private now that we are returning these valuse via readDapis()
    mapping(address => string) public override airnodeToSignedApiUrl;

    // The value should be a single value or an array of them
    // This needs to be encoded so we can determine if it's a beacon
    // or a beaconSet based on the lenght
    // It can be udpated by anyone because the contract will hash the data and derive it
    // Airseeker will need to multicall to read all data using a single RPC call
    // TODO: should this mapping be private now that we are returning these valuse via readDapis()
    mapping(bytes32 => bytes) public override dataFeedIdToData;

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
    ) external override {
        require(root != bytes32(0), "Root is zero");
        require(proof.length != 0, "Proof is empty");
        // Check root exists in HashRegistry
        require(
            hashRegistry.hashTypeToHash(API_INTEGRATION_HASH_TYPE) == root,
            "Root has not been registered"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(airnode, url)))
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        airnodeToSignedApiUrl[airnode] = url;

        emit RegisteredSignedApiUrl(airnode, url);
    }

    function unregisterAirnodeSignedApiUrl(address airnode) external override {
        require(airnode != address(0), "Airnode is zero");
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );

        // TODO: check if signed API URL is not being mapped to an Airnode in dataFeedIdToData?

        delete airnodeToSignedApiUrl[airnode];

        emit UnregisteredSignedApiUrl(airnode); // TODO: add msg.sender?
    }

    function registerDataFeed(
        bytes calldata dataFeedData
    ) external override returns (bytes32 dataFeedId) {
        require(dataFeedData.length > 0, "Data feed data is empty");
        bytes memory newDataFeedData;
        if (dataFeedData.length == 64) {
            // DataFeedId maps to a beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeedData,
                (address, bytes32)
            );

            // TODO: check if signed API URL exists for Airnode?

            // Derive beacon ID
            // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L87
            dataFeedId = keccak256(abi.encodePacked(airnode, templateId));
            newDataFeedData = dataFeedData;
        } else {
            // dataFeedData must have an even number of bytes32 pairs
            require(
                (dataFeedData.length / 2) % 32 == 0,
                "Invalid data feed data"
            );
            // DataFeedId maps to a beaconSet
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeedData, (address[], bytes32[]));
            require(airnodes.length == templateIds.length, "Length mismatch");
            bytes32[] memory beaconIds = new bytes32[](airnodes.length);
            for (uint256 i = 0; i < airnodes.length; i++) {
                // TODO: check if signed API URL exists for Airnode?

                // Derive beacon ID
                // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L87
                beaconIds[i] = keccak256(
                    abi.encodePacked(airnodes[i], templateIds[i])
                );
            }
            // Derive beacon set ID
            // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L98
            dataFeedId = keccak256(abi.encode(beaconIds));

            newDataFeedData = abi.encode(airnodes, templateIds);
        }

        dataFeedIdToData[dataFeedId] = newDataFeedData;

        emit RegisteredDataFeed(dataFeedId, newDataFeedData);
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
    ) external override {
        require(root != bytes32(0), "Root is zero");
        require(proof.length != 0, "Proof is empty");
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        // Check root exists in HashRegistry
        require(
            hashRegistry.hashTypeToHash(DAPI_MANAGEMENT_HASH_TYPE) == root,
            "Root has not been registered"
        );
        // Check dataFeedId has been registered
        require(
            dataFeedIdToData[dataFeedId].length > 0,
            "Data feed ID has not been registered"
        );

        // Verify proof
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, dataFeedId, sponsorWallet))
            )
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        activeDapis.add(dapiName); // TODO: Not checking if already exists in set to allow for update parameters override (downgrade/upgrade)
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

    function unregisterDapi(bytes32 dapiName) external override {
        require(dapiName != bytes32(0), "dAPI name is zero");
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        require(activeDapis.remove(dapiName), "dAPI name is not registered");
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        delete dapiNameHashToUpdateParameters[dapiNameHash];

        emit UnregisteredDapi(dapiName); // TODO: add msg.sender?
    }

    function registeredDapisCount()
        public
        view
        override
        returns (uint256 count)
    {
        count = activeDapis.length();
    }

    function readDapis(
        uint256 offset,
        uint256 limit
    )
        external
        view
        override
        returns (
            bytes32[] memory dapiNames,
            bytes32[] memory dataFeedIds,
            UpdateParameters[] memory updateParameters,
            bytes[] memory dataFeedDatas,
            string[][] memory signedApiUrls
        )
    {
        uint256 count = registeredDapisCount();
        require(offset < count, "Invalid offset");
        uint256 limitAdjusted = offset + limit > count ? count - offset : limit;
        dapiNames = new bytes32[](limitAdjusted);
        dataFeedIds = new bytes32[](limitAdjusted);
        updateParameters = new UpdateParameters[](limitAdjusted);
        dataFeedDatas = new bytes[](limitAdjusted);
        signedApiUrls = new string[][](limitAdjusted);
        for (uint256 i = offset; i < offset + limitAdjusted; i++) {
            bytes32 dapiName = activeDapis.at(i);
            uint256 currentIndex = i - offset;
            dapiNames[currentIndex] = dapiName;
            bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
            bytes32 dataFeedId = api3ServerV1.dapiNameHashToDataFeedId(
                dapiNameHash
            );
            dataFeedIds[currentIndex] = dataFeedId;
            updateParameters[currentIndex] = dapiNameHashToUpdateParameters[
                dapiNameHash
            ];
            bytes memory dataFeedData = dataFeedIdToData[dataFeedId];
            dataFeedDatas[currentIndex] = dataFeedData;
            if (dataFeedData.length == 64) {
                (address airnode, ) = abi.decode(
                    dataFeedData,
                    (address, bytes32)
                );
                string[] memory urls = new string[](1);
                urls[0] = airnodeToSignedApiUrl[airnode];
                signedApiUrls[currentIndex] = urls;
            } else {
                (address[] memory airnodes, ) = abi.decode(
                    dataFeedData,
                    (address[], bytes32[])
                );
                string[] memory urls = new string[](airnodes.length);
                for (uint256 j = 0; j < airnodes.length; j++) {
                    urls[j] = airnodeToSignedApiUrl[airnodes[j]];
                }
                signedApiUrls[currentIndex] = urls;
            }
        }
    }
}

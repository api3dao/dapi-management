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

    bytes32 private constant _DAPI_MANAGEMENT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI management Merkle tree root"));
    bytes32 private constant _SIGNED_API_URL_HASH_TYPE =
        keccak256(abi.encodePacked("Signed API URL Merkle root"));

    /// @notice Registrar role description
    string public constant override REGISTRAR_ROLE_DESCRIPTION = "Registrar";

    /// @notice Registrar role
    bytes32 public immutable override registrarRole;

    address public immutable override hashRegistry;
    address public immutable override api3ServerV1;

    // This is updated using the API management merkle tree
    mapping(address => string) public override airnodeToSignedApiUrl;

    // The value should be a single value or an array of them
    // This needs to be encoded so we can determine if it's a beacon
    // or a beaconSet based on the lenght
    // It can be udpated by anyone because the contract will hash the data and derive it
    // Airseeker will need to multicall to read all data using a single RPC call
    mapping(bytes32 => bytes) public override dataFeeds;

    // This is the list of dAPIs AirseekerV2 will need to update
    // Api3Market contract will have a role to update this after a purchase
    // Dapi names are expected to be unique bytes32 strings
    EnumerableSet.Bytes32Set private activeDapis;

    mapping(bytes32 => UpdateParameters) private dapiNameHashToUpdateParameters;

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _hashRegistry,
        address _api3ServerV1
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        require(_hashRegistry != address(0), "HashRegistry address is zero");
        require(_api3ServerV1 != address(0), "Api3ServerV1 address is zero");
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
            IHashRegistry(hashRegistry).hashTypeToHash(
                _SIGNED_API_URL_HASH_TYPE
            ) == root,
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

    function registerDataFeed(
        bytes calldata dataFeed
    ) external override returns (bytes32 dataFeedId) {
        require(dataFeed.length > 0, "Data feed is empty");
        bytes memory newDataFeed;
        if (dataFeed.length == 64) {
            // dataFeedId maps to a beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeed,
                (address, bytes32)
            );

            // Derive beacon ID
            // https://github.com/api3dao/airnode-protocol-v1/blob/main/contracts/api3-server-v1/DataFeedServer.sol#L87
            dataFeedId = keccak256(abi.encodePacked(airnode, templateId));
            newDataFeed = dataFeed;
        } else {
            // dataFeed must have an even number of bytes32 pairs
            require((dataFeed.length / 2) % 32 == 0, "Invalid data feed");
            // dataFeedId maps to a beaconSet
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeed, (address[], bytes32[]));
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

            newDataFeed = abi.encode(airnodes, templateIds);
        }

        dataFeeds[dataFeedId] = newDataFeed;

        emit RegisteredDataFeed(dataFeedId, newDataFeed);
    }

    function addDapi(
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
            IHashRegistry(hashRegistry).hashTypeToHash(
                _DAPI_MANAGEMENT_HASH_TYPE
            ) == root,
            "Root has not been registered"
        );
        // Check dataFeedId has been registered
        require(
            dataFeeds[dataFeedId].length > 0,
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
        IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);

        emit AddedDapi(
            dapiName,
            dataFeedId,
            sponsorWallet,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval
        );
    }

    function removeDapi(bytes32 dapiName) external override {
        require(dapiName != bytes32(0), "dAPI name is zero");
        require(
            hasRegistrarRoleOrIsManager(msg.sender),
            "Sender is not manager or needs Registrar role"
        );
        require(activeDapis.remove(dapiName), "dAPI name has not been added");
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        delete dapiNameHashToUpdateParameters[dapiNameHash];

        emit RemovedDapi(dapiName); // TODO: add msg.sender?
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
            bytes[] memory dataFeeds_,
            string[][] memory signedApiUrls
        )
    {
        uint256 count = registeredDapisCount();
        require(offset < count, "Invalid offset");
        uint256 limitAdjusted = offset + limit > count ? count - offset : limit;
        dapiNames = new bytes32[](limitAdjusted);
        dataFeedIds = new bytes32[](limitAdjusted);
        updateParameters = new UpdateParameters[](limitAdjusted);
        dataFeeds_ = new bytes[](limitAdjusted);
        signedApiUrls = new string[][](limitAdjusted);
        for (uint256 i = offset; i < offset + limitAdjusted; i++) {
            bytes32 dapiName = activeDapis.at(i);
            uint256 currentIndex = i - offset;
            dapiNames[currentIndex] = dapiName;
            bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
            bytes32 dataFeedId = IApi3ServerV1(api3ServerV1)
                .dapiNameHashToDataFeedId(dapiNameHash);
            dataFeedIds[currentIndex] = dataFeedId;
            updateParameters[currentIndex] = dapiNameHashToUpdateParameters[
                dapiNameHash
            ];
            bytes memory dataFeed = dataFeeds[dataFeedId];
            dataFeeds_[currentIndex] = dataFeed;
            if (dataFeed.length == 64) {
                (address airnode, ) = abi.decode(dataFeed, (address, bytes32));
                string[] memory urls = new string[](1);
                urls[0] = airnodeToSignedApiUrl[airnode];
                signedApiUrls[currentIndex] = urls;
            } else {
                (address[] memory airnodes, ) = abi.decode(
                    dataFeed,
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

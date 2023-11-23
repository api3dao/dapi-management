// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/interfaces/IApi3ServerV1.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IDapiDataRegistry.sol";
import "./interfaces/IHashRegistry.sol";

/// @title Contract used to store and manage dAPI related information
/// @notice The DapiDataRegistry contract main use case is storing all the active
/// dAPI names. By active we mean the list of data feeds currently being updated.
/// This contract will also require that caller also provides update parameter
/// information at the time a new dAPI is added. Previous to this, the user must
/// have called registerDataFeed() to store data feed data that is needed for
/// updating the data feed the dAPI name is point to. For instance, storing an
/// encoded bytes with the Airnode address plus the template ID (when data feed
/// is a beacon) or an array of Airnode addresses plus an array of template IDs
/// (when the data feed is a beacon set) is required prior to adding a dAPI name.
/// This contract will also store all Signed API URLs that should be used for
/// fetching current API values while trying to update the data feed.
/// Another feature is that it provides an optimized way for reading all dAPI
/// related data by using a single RPC call. Since it has a reference to
/// Api3ServerV1 contract, it can return all data stored in this contract plus
/// current data feed values stored in Api3ServerV1
contract DapiDataRegistry is
    AccessControlRegistryAdminnedWithManager,
    IDapiDataRegistry
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    /// @notice dAPI adder role description
    string public constant override DAPI_ADDER_ROLE_DESCRIPTION = "dAPI adder";
    /// @notice dAPI remover role description
    string public constant override DAPI_REMOVER_ROLE_DESCRIPTION =
        "dAPI remover";

    /// @notice dAPI adder role
    bytes32 public immutable override dapiAdderRole;
    /// @notice dAPI remover role
    bytes32 public immutable override dapiRemoverRole;

    /// @notice HashRegistry contract address
    address public immutable override hashRegistry;
    /// @notice Api3ServerV1 contract address
    address public immutable override api3ServerV1;

    /// @notice Airnode Signed API URLs
    /// @dev The values stored in this mapping rely on a merkle tree that must be
    /// verified and signed by a set of accounts prior to registering the root
    /// hash on the HashRegistry contract
    mapping(address => string) public override airnodeToSignedApiUrl;

    /// @notice Encoded data feed data for each data feed ID
    /// @dev The length of the bytes is used to determine if the encoded data
    /// feed data belongs to a beacon or beacon set
    mapping(bytes32 => bytes) public override dataFeeds;

    /// @notice Parameters used while checking the conditions for updating a dAPI
    mapping(bytes32 => UpdateParameters)
        public
        override dapiNameToUpdateParameters;

    EnumerableSet.Bytes32Set private dapis;

    bytes32 private constant DAPI_MANAGEMENT_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("dAPI management Merkle tree root"));
    bytes32 private constant SIGNED_API_URL_MERKLE_TREE_ROOT_HASH_TYPE =
        keccak256(abi.encodePacked("Signed API URL Merkle tree root"));

    /// @param _accessControlRegistry AccessControlRegistry contract address
    /// @param _adminRoleDescription Admin role description
    /// @param _manager Manager address
    /// @param _hashRegistry HashRegistry contract address
    /// @param _api3ServerV1 Api3ServerV1 contract address
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
        dapiAdderRole = _deriveRole(
            _deriveAdminRole(manager),
            DAPI_ADDER_ROLE_DESCRIPTION
        );
        dapiRemoverRole = _deriveRole(
            _deriveAdminRole(manager),
            DAPI_REMOVER_ROLE_DESCRIPTION
        );
        hashRegistry = _hashRegistry;
        api3ServerV1 = _api3ServerV1;
    }

    /// @notice Called to register a Signed API URL for an Airnode
    /// @param airnode Airnode address
    /// @param url Signed API URL
    /// @param root Merkle tree root hash
    /// @param proof Array of hashes to verify a Merkle tree leaf
    function registerAirnodeSignedApiUrl(
        address airnode,
        string calldata url,
        bytes32 root,
        bytes32[] calldata proof
    ) external override {
        require(airnode != address(0), "Airnode is zero");
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(
                SIGNED_API_URL_MERKLE_TREE_ROOT_HASH_TYPE
            ) == root,
            "Root has not been registered"
        );
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(airnode, url)))
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        if (
            keccak256(abi.encodePacked((airnodeToSignedApiUrl[airnode]))) !=
            keccak256(abi.encodePacked((url)))
        ) {
            airnodeToSignedApiUrl[airnode] = url;

            emit RegisteredSignedApiUrl(airnode, url);
        }
    }

    /// @notice Called to register data about a data feed
    /// @dev Data feed IDs are derived based on this data. If the encoded bytes
    /// have a length of 64, it is considered data for deriving a beacon ID.
    /// Otherwise, it is considered data for deriving beacon IDs that are then
    /// used to derive the beacon set ID
    /// @param dataFeed Encoded data feed data
    function registerDataFeed(
        bytes calldata dataFeed
    ) external override returns (bytes32 dataFeedId) {
        if (dataFeed.length == 64) {
            // dataFeedId maps to a beacon
            (address airnode, bytes32 templateId) = abi.decode(
                dataFeed,
                (address, bytes32)
            );
            // Derive beacon ID
            dataFeedId = keccak256(abi.encodePacked(airnode, templateId));
        } else {
            require(dataFeed.length != 0, "Data feed is empty");
            // dataFeedId maps to a beaconSet
            (address[] memory airnodes, bytes32[] memory templateIds) = abi
                .decode(dataFeed, (address[], bytes32[]));
            require(
                abi.encode(airnodes, templateIds).length == dataFeed.length,
                "Invalid data feed"
            );
            require(airnodes.length == templateIds.length, "Length mismatch");
            bytes32[] memory beaconIds = new bytes32[](airnodes.length);
            for (uint256 i = 0; i < airnodes.length; i++) {
                // Derive beacon ID
                beaconIds[i] = keccak256(
                    abi.encodePacked(airnodes[i], templateIds[i])
                );
            }
            // Derive beacon set ID
            dataFeedId = keccak256(abi.encode(beaconIds));
        }

        if (
            keccak256(abi.encodePacked((dataFeeds[dataFeedId]))) !=
            keccak256(abi.encodePacked((dataFeed)))
        ) {
            dataFeeds[dataFeedId] = dataFeed;

            emit RegisteredDataFeed(dataFeedId, dataFeed);
        }
    }

    /// Called by a registrar or manager to add a dAPI along with update
    /// parameters data
    /// @dev Since this function does not check if the dAPI already exists, the
    /// caller is responsible with previously validating how the update
    /// parameters are being overwritten. This by design to allow for update
    /// parameters override (downgrade/upgrade)
    /// @param dapiName dAPI name
    /// @param dataFeedId Data feed ID the dAPI will point to
    /// @param sponsorWallet Sponsor wallet address used to trigger updates
    /// @param deviationThresholdInPercentage Value used to determine if data
    /// feed requires updating based on deviation against API value
    /// @param deviationReference Reference value that deviation will be
    /// calculated against
    /// @param heartbeatInterval Value used to determine if data
    /// feed requires updating based on time elapsed since last update
    /// @param root Merkle tree root hash
    /// @param proof Array of hashes to verify a Merkle tree leaf
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
        require(
            msg.sender == manager ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    dapiAdderRole,
                    msg.sender
                ),
            "Sender is not manager or has dAPI adder role"
        );
        require(dapiName != bytes32(0), "dAPI name is zero");
        require(dataFeedId != bytes32(0), "Data feed ID is zero");
        require(sponsorWallet != address(0), "Sponsor wallet is zero");
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(
                DAPI_MANAGEMENT_MERKLE_TREE_ROOT_HASH_TYPE
            ) == root,
            "Root has not been registered"
        );
        require(
            dataFeeds[dataFeedId].length > 0,
            "Data feed ID has not been registered"
        );
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, dataFeedId, sponsorWallet))
            )
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        dapis.add(dapiName);
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        dapiNameToUpdateParameters[dapiNameHash] = UpdateParameters(
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval
        );

        // This contract needs to be granted the dAPI name setter role
        // https://github.com/api3dao/airnode-protocol-v1/blob/v2.10.0/contracts/api3-server-v1/DapiServer.sol#L26
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

    /// @notice Called by a registrar or manager to remove a dAPI
    /// @param dapiName dAPI name
    function removeDapi(bytes32 dapiName) public override {
        require(
            msg.sender == manager ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    dapiRemoverRole,
                    msg.sender
                ),
            "Sender is not manager or has dAPI remover role"
        );
        require(dapis.remove(dapiName), "dAPI name has not been added");
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        delete dapiNameToUpdateParameters[dapiNameHash];
        emit RemovedDapi(dapiName, msg.sender);
    }

    /// Called by anyone to set the data feed ID the dAPI points to
    /// @dev dAPI update parameters will remain unchanged
    /// @param dapiName dAPI name
    /// @param dataFeedId Data feed ID the dAPI will point to
    /// @param sponsorWallet Sponsor wallet address used to trigger updates
    /// @param root Merkle tree root hash
    /// @param proof Array of hashes to verify a Merkle tree leaf
    function updateDapiDataFeedId(
        bytes32 dapiName,
        bytes32 dataFeedId,
        address sponsorWallet,
        bytes32 root,
        bytes32[] calldata proof
    ) external override {
        require(dapiName != bytes32(0), "dAPI name is zero");
        require(dataFeedId != bytes32(0), "Data feed ID is zero");
        require(sponsorWallet != address(0), "Sponsor wallet is zero");
        require(dapis.contains(dapiName), "dAPI name has not been added");
        require(
            IHashRegistry(hashRegistry).hashTypeToHash(
                DAPI_MANAGEMENT_MERKLE_TREE_ROOT_HASH_TYPE
            ) == root,
            "Root has not been registered"
        );
        require(
            dataFeeds[dataFeedId].length > 0,
            "Data feed ID has not been registered"
        );
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(abi.encode(dapiName, dataFeedId, sponsorWallet))
            )
        );
        require(MerkleProof.verify(proof, root, leaf), "Invalid proof");

        // This contract needs to be granted the dAPI name setter role
        IApi3ServerV1(api3ServerV1).setDapiName(dapiName, dataFeedId);

        emit UpdatedDapiDataFeedId(
            dapiName,
            dataFeedId,
            sponsorWallet,
            msg.sender
        );
    }

    /// @notice Called to get the total count of dAPI names
    /// @return count dAPI name count
    function dapisCount() public view override returns (uint256 count) {
        count = dapis.length();
    }

    /// Called to get details about a dAPI by providing a dAPI name
    /// @dev This function can be multicall'ed statically becuase this contract
    /// inherits SelfMulticall
    /// @param dapiName dAPI name
    /// @return updateParameters Update parameters like deviation and heartbeat
    /// @return dataFeedValue Last known data feed value
    /// @return dataFeed encoded Airnode address(es) and templateId(s)
    /// @return signedApiUrls Array with Airnode Signed API URLs
    function readDapiWithName(
        bytes32 dapiName
    )
        public
        view
        override
        returns (
            UpdateParameters memory updateParameters,
            DataFeedValue memory dataFeedValue,
            bytes memory dataFeed,
            string[] memory signedApiUrls
        )
    {
        bytes32 dapiNameHash = keccak256(abi.encodePacked(dapiName));
        bytes32 dataFeedId = IApi3ServerV1(api3ServerV1)
            .dapiNameHashToDataFeedId(dapiNameHash);
        if (dataFeedId != bytes32(0)) {
            (int224 value, uint32 timestamp) = IApi3ServerV1(api3ServerV1)
                .dataFeeds(dataFeedId);
            dataFeedValue = DataFeedValue(value, timestamp);
            updateParameters = dapiNameToUpdateParameters[dapiNameHash];
            dataFeed = dataFeeds[dataFeedId];
            if (dataFeed.length == 64) {
                (address airnode, ) = abi.decode(dataFeed, (address, bytes32));
                string[] memory urls = new string[](1);
                urls[0] = airnodeToSignedApiUrl[airnode];
                signedApiUrls = urls;
            } else {
                (address[] memory airnodes, ) = abi.decode(
                    dataFeed,
                    (address[], bytes32[])
                );
                string[] memory urls = new string[](airnodes.length);
                for (uint256 ind2 = 0; ind2 < airnodes.length; ind2++) {
                    urls[ind2] = airnodeToSignedApiUrl[airnodes[ind2]];
                }
                signedApiUrls = urls;
            }
        }
    }

    /// Called to get details about a dAPI by providing its index in storage
    /// @dev This function can be multicall'ed statically becuase this contract
    /// inherits SelfMulticall
    /// @param index dAPI name index
    /// @return dapiName dAPI name for the given index
    /// @return updateParameters Update parameters like deviation and heartbeat
    /// @return dataFeedValue Last known data feed value
    /// @return dataFeed encoded Airnode address(es) and templateId(s)
    /// @return signedApiUrls Array with Airnode Signed API URLs
    function readDapiWithIndex(
        uint256 index
    )
        external
        view
        override
        returns (
            bytes32 dapiName,
            UpdateParameters memory updateParameters,
            DataFeedValue memory dataFeedValue,
            bytes memory dataFeed,
            string[] memory signedApiUrls
        )
    {
        uint256 count = dapisCount();
        if (index < count) {
            dapiName = dapis.at(index);
            (
                updateParameters,
                dataFeedValue,
                dataFeed,
                signedApiUrls
            ) = readDapiWithName(dapiName);
        }
    }
}

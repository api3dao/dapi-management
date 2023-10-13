const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const {
  generateRandomBytes32,
  generateRandomAddress,
  deriveRootRole,
  deriveRole,
  buildEIP712Domain,
} = require('./test-utils');

describe('DapiDataRegistry', function () {
  function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters.charAt(randomIndex);
    }

    return result;
  }

  const deploy = async () => {
    const roleNames = [
      'deployer',
      'manager',
      'owner',
      'api3MarketContract',
      'rootSigner1',
      'rootSigner2',
      'rootSigner3',
      'airnode',
      'sponsorWallet',
      'randomPerson',
    ];
    const accounts = await hre.ethers.getSigners();
    const roles = roleNames.reduce((acc, roleName, index) => {
      return { ...acc, [roleName]: accounts[index] };
    }, {});

    const TimestampedHashRegistry = await hre.ethers.getContractFactory('TimestampedHashRegistry', roles.deployer);
    const timestampedHashRegistry = await TimestampedHashRegistry.deploy();
    await timestampedHashRegistry.connect(roles.deployer).transferOwnership(roles.owner.address);

    const AccessControlRegistry = await hre.ethers.getContractFactory('AccessControlRegistry', roles.deployer);
    const accessControlRegistry = await AccessControlRegistry.deploy();

    const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
    const Api3ServerV1 = await hre.ethers.getContractFactory('MockApi3ServerV1', roles.deployer);
    const api3ServerV1 = await Api3ServerV1.deploy(
      accessControlRegistry.address,
      api3ServerV1AdminRoleDescription,
      roles.manager.address
    );

    const dapiDataRegistryAdminRoleDescription = 'DapiDataRegistry admin';
    const DapiDataRegistry = await hre.ethers.getContractFactory('DapiDataRegistry', roles.deployer);
    const dapiDataRegistry = await DapiDataRegistry.deploy(
      accessControlRegistry.address,
      dapiDataRegistryAdminRoleDescription,
      roles.manager.address,
      timestampedHashRegistry.address,
      api3ServerV1.address
    );

    const rootRole = deriveRootRole(roles.manager.address);
    const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);
    const registerDataRoleDescription = await dapiDataRegistry.REGISTER_DATA_ROLE_DESCRIPTION();
    const registerDataRole = deriveRole(dapiDataRegistryAdminRole, registerDataRoleDescription);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, registerDataRoleDescription);

    await accessControlRegistry.connect(roles.manager).grantRole(registerDataRole, roles.api3MarketContract.address);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        await api3ServerV1.adminRole(),
        await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION()
      );
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiDataRegistry.address);

    const timestamp = Math.floor(Date.now() / 1000);
    const chainId = (await timestampedHashRegistry.provider.getNetwork()).chainId;
    const domain = buildEIP712Domain('TimestampedHashRegistry', chainId, timestampedHashRegistry.address);
    const types = {
      SignedHash: [
        { name: 'hashType', type: 'bytes32' },
        { name: 'hash', type: 'bytes32' },
        { name: 'timestamp', type: 'uint256' },
      ],
    };

    const oisTitle = generateRandomBytes32();
    const baseUrl = 'https://example.com/';
    const url = baseUrl + generateRandomString(10);

    const apiTreeEntry = [roles.airnode.address, oisTitle, url];
    const apiTreeValues = [
      [generateRandomAddress(), generateRandomBytes32(), baseUrl + generateRandomString(10)],
      [generateRandomAddress(), generateRandomBytes32(), baseUrl + generateRandomString(15)],
      apiTreeEntry,
      [generateRandomAddress(), generateRandomBytes32(), baseUrl + generateRandomString(5)],
      [generateRandomAddress(), generateRandomBytes32(), baseUrl + generateRandomString(20)],
    ];
    const apiTree = StandardMerkleTree.of(apiTreeValues, ['address', 'bytes32', 'string']);
    const apiTreeRoot = apiTree.root;
    const apiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['Signed API URL root']);
    const rootSigners = [roles.rootSigner1, roles.rootSigner2, roles.rootSigner3];
    const apiTreeRootSignatures = await Promise.all(
      rootSigners.map(
        async (rootSigner) =>
          await rootSigner._signTypedData(domain, types, {
            hashType: apiHashType,
            hash: apiTreeRoot,
            timestamp,
          })
      )
    );
    const apiTreeProof = apiTree.getProof(apiTreeEntry);

    await timestampedHashRegistry.connect(roles.owner).setupSigners(
      apiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await timestampedHashRegistry.registerHash(apiHashType, apiTreeRoot, timestamp, apiTreeRootSignatures);

    const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
    const beacons = Array(5)
      .fill()
      .map(() => {
        return {
          airnode: generateRandomAddress(),
          templateId: generateRandomBytes32(),
        };
      });
    const encodedBeacons = beacons.map((dataFeed) =>
      hre.ethers.utils.defaultAbiCoder.encode(['address', 'bytes32'], [dataFeed.airnode, dataFeed.templateId])
    );
    const dataFeedIds = encodedBeacons.map((dataFeedData) => hre.ethers.utils.keccak256(dataFeedData));
    const dataFeedId = hre.ethers.utils.keccak256(
      hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [dataFeedIds])
    );
    const dapiTreeEntry = [dapiName, dataFeedId, roles.sponsorWallet.address];
    const dapiTreeValues = [
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      dapiTreeEntry,
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
    ];
    const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
    const dapiTreeRoot = dapiTree.root;
    const dapiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI management root']);
    // TODO: should I use a different set of signer addresses here?
    const dapiTreeRootSignatures = await Promise.all(
      rootSigners.map(
        async (rootSigner) =>
          await rootSigner._signTypedData(domain, types, {
            hashType: dapiHashType,
            hash: dapiTreeRoot,
            timestamp, // TODO: use different timestamp?
          })
      )
    );
    const dapiTreeProof = dapiTree.getProof(dapiTreeEntry);

    await timestampedHashRegistry.connect(roles.owner).setupSigners(
      dapiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await timestampedHashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);

    return {
      roles,
      dapiDataRegistryAdminRole,
      registerDataRole,
      accessControlRegistry,
      dapiDataRegistry,
      timestampedHashRegistry,
      api3ServerV1,
      dapiDataRegistryAdminRoleDescription,
      oisTitle,
      url,
      apiHashType,
      apiTreeRoot,
      apiTreeProof,
      dapiName,
      dataFeedId,
      encodedBeacons,
      dapiHashType,
      dapiTreeRoot,
      dapiTreeProof,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const {
        roles,
        registerDataRole,
        accessControlRegistry,
        dapiDataRegistry,
        timestampedHashRegistry,
        api3ServerV1,
        dapiDataRegistryAdminRoleDescription,
      } = await helpers.loadFixture(deploy);
      expect(await dapiDataRegistry.accessControlRegistry()).to.equal(accessControlRegistry.address);
      expect(await dapiDataRegistry.adminRoleDescription()).to.equal(dapiDataRegistryAdminRoleDescription);
      expect(await dapiDataRegistry.manager()).to.equal(roles.manager.address);
      expect(await dapiDataRegistry.registerDataRole()).to.equal(registerDataRole);
      expect(await dapiDataRegistry.timestampedHashRegistry()).to.equal(timestampedHashRegistry.address);
      expect(await dapiDataRegistry.api3ServerV1()).to.equal(api3ServerV1.address);
    });
  });

  describe('registerAirnodeSignedApiUrl', function () {
    it('registers an Airnode signed API URL', async function () {
      const { roles, dapiDataRegistry, oisTitle, url, apiHashType, apiTreeRoot, apiTreeProof } =
        await helpers.loadFixture(deploy);

      await expect(
        dapiDataRegistry
          .connect(roles.api3MarketContract)
          .registerAirnodeSignedApiUrl(apiHashType, roles.airnode.address, oisTitle, url, apiTreeRoot, apiTreeProof)
      )
        .to.emit(dapiDataRegistry, 'RegisteredSignedApiUrl')
        .withArgs(roles.airnode.address, oisTitle, url);
      expect(await dapiDataRegistry.airnodeToSignedApi(roles.airnode.address)).to.deep.equal([oisTitle, url]);
    });
  });

  describe('registerDatafeed', function () {
    it('registers beacon datafeed', async function () {
      const { roles, dapiDataRegistry, encodedBeacons } = await helpers.loadFixture(deploy);

      const [encodedBeacon] = encodedBeacons;
      const dataFeedId = hre.ethers.utils.keccak256(encodedBeacon);

      await expect(dapiDataRegistry.connect(roles.randomPerson).registerDatafeed(encodedBeacon))
        .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
        .withArgs(dataFeedId, encodedBeacon);
      expect(await dapiDataRegistry.dataFeedIdToDataFeedData(dataFeedId)).to.deep.equal(encodedBeacon);
    });
    it('registers beaconSet datafeed', async function () {
      const { roles, dapiDataRegistry, dataFeedId, encodedBeacons } = await helpers.loadFixture(deploy);

      const dataFeedData = hre.ethers.utils.defaultAbiCoder.encode(['bytes[]'], [encodedBeacons]);

      await expect(dapiDataRegistry.connect(roles.randomPerson).registerDatafeed(dataFeedData))
        .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
        .withArgs(dataFeedId, dataFeedData);
      expect(await dapiDataRegistry.dataFeedIdToDataFeedData(dataFeedId)).to.deep.equal(dataFeedData);
    });
  });

  describe('registerDapi', function () {
    it('registers a dAPI', async function () {
      const {
        roles,
        dapiDataRegistry,
        dapiName,
        dataFeedId,
        encodedBeacons,
        dapiHashType,
        dapiTreeRoot,
        dapiTreeProof,
      } = await helpers.loadFixture(deploy);

      const dataFeedData = hre.ethers.utils.defaultAbiCoder.encode(['bytes[]'], [encodedBeacons]);
      await dapiDataRegistry.connect(roles.randomPerson).registerDatafeed(dataFeedData);

      await expect(
        dapiDataRegistry.connect(roles.api3MarketContract).registerDapi(
          dapiHashType,
          dapiName,
          dataFeedId,
          roles.sponsorWallet.address,
          1, //deviationThreshold,
          86400, //heartbeatInterval,
          dapiTreeRoot,
          dapiTreeProof
        )
      )
        .to.emit(dapiDataRegistry, 'RegisteredDapi')
        .withArgs(dapiName, dataFeedId, roles.sponsorWallet.address, 1, 86400);

      const dapisCount = await dapiDataRegistry.registeredDapisCount();
      expect(dapisCount).to.equal(1);
      const [dapiNameHashes, dataFeedIds, updateParameters] = await dapiDataRegistry.readDapis(0, dapisCount);
      expect(dapiNameHashes).to.deep.equal([hre.ethers.utils.solidityKeccak256(['bytes32'], [dapiName])]);
      expect(dataFeedIds).to.deep.equal([dataFeedId]);
      expect(updateParameters[0].deviationThreshold).to.deep.equal(hre.ethers.BigNumber.from(1));
      expect(updateParameters[0].heartbeatInterval).to.deep.equal(hre.ethers.BigNumber.from(86400));
    });
  });
});

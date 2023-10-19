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
  const HUNDRED_PERCENT = 1e8;

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

    const HashRegistry = await hre.ethers.getContractFactory('HashRegistry', roles.deployer);
    const hashRegistry = await HashRegistry.deploy();
    await hashRegistry.connect(roles.deployer).transferOwnership(roles.owner.address);

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
      hashRegistry.address,
      api3ServerV1.address
    );

    const rootRole = deriveRootRole(roles.manager.address);
    const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);
    const registrarRoleDescription = await dapiDataRegistry.REGISTRAR_ROLE_DESCRIPTION();
    const registrarRole = deriveRole(dapiDataRegistryAdminRole, registrarRoleDescription);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, registrarRoleDescription);

    await accessControlRegistry.connect(roles.manager).grantRole(registrarRole, roles.api3MarketContract.address);

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
    const chainId = (await hashRegistry.provider.getNetwork()).chainId;
    const domain = buildEIP712Domain('HashRegistry', chainId, hashRegistry.address);
    const types = {
      SignedHash: [
        { name: 'hashType', type: 'bytes32' },
        { name: 'hash', type: 'bytes32' },
        { name: 'timestamp', type: 'uint256' },
      ],
    };

    const baseUrl = 'https://example.com/';
    const url = baseUrl + generateRandomString(10);

    const apiTreeEntry = [roles.airnode.address, url];
    const apiTreeValues = [
      [generateRandomAddress(), baseUrl + generateRandomString(10)],
      [generateRandomAddress(), baseUrl + generateRandomString(15)],
      apiTreeEntry,
      [generateRandomAddress(), baseUrl + generateRandomString(5)],
      [generateRandomAddress(), baseUrl + generateRandomString(20)],
    ];
    const apiTree = StandardMerkleTree.of(apiTreeValues, ['address', 'string']);
    const apiTreeRoot = apiTree.root;
    const apiHashType = hre.ethers.utils.solidityKeccak256(
      ['string'],
      [await dapiDataRegistry.API_INTEGRATION_HASH_TYPE_DESCRIPTION()]
    );
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

    await hashRegistry.connect(roles.owner).setupSigners(
      apiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(apiHashType, apiTreeRoot, timestamp, apiTreeRootSignatures);

    const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
    const dataFeedData = Array(5)
      .fill()
      .map(() => {
        return {
          airnode: generateRandomAddress(),
          templateId: generateRandomBytes32(),
        };
      });

    const beaconIds = dataFeedData.map(({ airnode, templateId }) =>
      hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode, templateId])
    );
    const beaconSetId = hre.ethers.utils.keccak256(hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]));
    const dapiTreeEntry = [dapiName, beaconSetId, roles.sponsorWallet.address];
    const dapiTreeValues = [
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      dapiTreeEntry,
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
    ];
    const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
    const dapiTreeRoot = dapiTree.root;
    const dapiHashType = hre.ethers.utils.solidityKeccak256(
      ['string'],
      [await dapiDataRegistry.DAPI_MANAGEMENT_HASH_TYPE_DESCRIPTION()]
    );
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

    await hashRegistry.connect(roles.owner).setupSigners(
      dapiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);

    return {
      roles,
      dapiDataRegistryAdminRole,
      registrarRole,
      accessControlRegistry,
      dapiDataRegistry,
      hashRegistry,
      api3ServerV1,
      dapiDataRegistryAdminRoleDescription,
      url,
      apiTreeRoot,
      apiTreeProof,
      dataFeedData,
      dapiName,
      beaconSetId,
      dapiTreeRoot,
      dapiTreeProof,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const {
        roles,
        registrarRole,
        accessControlRegistry,
        dapiDataRegistry,
        hashRegistry,
        api3ServerV1,
        dapiDataRegistryAdminRoleDescription,
      } = await helpers.loadFixture(deploy);
      expect(await dapiDataRegistry.accessControlRegistry()).to.equal(accessControlRegistry.address);
      expect(await dapiDataRegistry.adminRoleDescription()).to.equal(dapiDataRegistryAdminRoleDescription);
      expect(await dapiDataRegistry.manager()).to.equal(roles.manager.address);
      expect(await dapiDataRegistry.registrarRole()).to.equal(registrarRole);
      expect(await dapiDataRegistry.hashRegistry()).to.equal(hashRegistry.address);
      expect(await dapiDataRegistry.api3ServerV1()).to.equal(api3ServerV1.address);
    });
  });

  describe('registerAirnodeSignedApiUrl', function () {
    it('registers an Airnode signed API URL', async function () {
      const { roles, dapiDataRegistry, url, apiTreeRoot, apiTreeProof } = await helpers.loadFixture(deploy);

      await expect(
        dapiDataRegistry
          .connect(roles.api3MarketContract)
          .registerAirnodeSignedApiUrl(roles.airnode.address, url, apiTreeRoot, apiTreeProof)
      )
        .to.emit(dapiDataRegistry, 'RegisteredSignedApiUrl')
        .withArgs(roles.airnode.address, url);
      expect(await dapiDataRegistry.airnodeToSignedApiUrl(roles.airnode.address)).to.equal(url);
    });
  });

  describe('registerDataFeed', function () {
    it('registers beacon data feed', async function () {
      const { roles, dapiDataRegistry, dataFeedData } = await helpers.loadFixture(deploy);

      const encodedBeaconData = hre.ethers.utils.defaultAbiCoder.encode(
        ['address', 'bytes32'],
        [dataFeedData[0].airnode, dataFeedData[0].templateId]
      );
      const dataFeedId = hre.ethers.utils.solidityKeccak256(
        ['address', 'bytes32'],
        [dataFeedData[0].airnode, dataFeedData[0].templateId]
      );

      await expect(dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconData))
        .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
        .withArgs(dataFeedId, encodedBeaconData);
      expect(await dapiDataRegistry.dataFeedIdToData(dataFeedId)).to.equal(encodedBeaconData);
    });
    it('registers beaconSet data feed', async function () {
      const { roles, dapiDataRegistry, dataFeedData, beaconSetId } = await helpers.loadFixture(deploy);

      const { airnodes, templateIds } = dataFeedData.reduce(
        (acc, { airnode, templateId }) => ({
          airnodes: [...acc.airnodes, airnode],
          templateIds: [...acc.templateIds, templateId],
        }),
        { airnodes: [], templateIds: [] }
      );
      const encodedBeaconSetData = hre.ethers.utils.defaultAbiCoder.encode(
        ['address[]', 'bytes32[]'],
        [airnodes, templateIds]
      );

      await expect(dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData))
        .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
        .withArgs(beaconSetId, encodedBeaconSetData);
      expect(await dapiDataRegistry.dataFeedIdToData(beaconSetId)).to.deep.equal(encodedBeaconSetData);
    });
  });

  describe('registerDapi', function () {
    it('registers a dAPI', async function () {
      const { roles, dapiDataRegistry, dataFeedData, dapiName, beaconSetId, dapiTreeRoot, dapiTreeProof } =
        await helpers.loadFixture(deploy);

      const { airnodes, templateIds } = dataFeedData.reduce(
        (acc, { airnode, templateId }) => ({
          airnodes: [...acc.airnodes, airnode],
          templateIds: [...acc.templateIds, templateId],
        }),
        { airnodes: [], templateIds: [] }
      );
      const encodedBeaconSetData = hre.ethers.utils.defaultAbiCoder.encode(
        ['address[]', 'bytes32[]'],
        [airnodes, templateIds]
      );
      await dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData);

      const deviationThresholdInPercentage = hre.ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
      const deviationReference = hre.ethers.constants.Zero; // Not used in Airseeker V1
      const heartbeatInterval = hre.ethers.BigNumber.from(86400); // 24 hrs

      await expect(
        dapiDataRegistry
          .connect(roles.api3MarketContract)
          .registerDapi(
            dapiName,
            beaconSetId,
            roles.sponsorWallet.address,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval,
            dapiTreeRoot,
            dapiTreeProof
          )
      )
        .to.emit(dapiDataRegistry, 'RegisteredDapi')
        .withArgs(
          dapiName,
          beaconSetId,
          roles.sponsorWallet.address,
          deviationThresholdInPercentage,
          deviationReference,
          heartbeatInterval
        );

      const dapisCount = await dapiDataRegistry.registeredDapisCount();
      expect(dapisCount).to.equal(1);
      const [dapiNames, dataFeedIds, updateParameters, dataFeedDatas] = await dapiDataRegistry.readDapis(0, dapisCount);
      expect(dapiNames).to.deep.equal([dapiName]);
      expect(dataFeedIds).to.deep.equal([beaconSetId]);
      expect(updateParameters[0].deviationThresholdInPercentage).to.deep.equal(deviationThresholdInPercentage);
      expect(updateParameters[0].deviationReference).to.deep.equal(deviationReference);
      expect(updateParameters[0].heartbeatInterval).to.deep.equal(heartbeatInterval);
      expect(dataFeedDatas).to.deep.equal([encodedBeaconSetData]);
    });
  });
});

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
      'airnode1',
      'airnode2',
      'airnode3',
      'airnode4',
      'airnode5',
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
    const apiTreeValues = [
      [roles.airnode1.address, baseUrl + generateRandomString(10)],
      [roles.airnode2.address, baseUrl + generateRandomString(15)],
      [roles.airnode3.address, baseUrl + generateRandomString(10)],
      [roles.airnode4.address, baseUrl + generateRandomString(5)],
      [roles.airnode5.address, baseUrl + generateRandomString(20)],
    ];
    const apiTree = StandardMerkleTree.of(apiTreeValues, ['address', 'string']);
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
            hash: apiTree.root,
            timestamp,
          })
      )
    );
    await hashRegistry.connect(roles.owner).setupSigners(
      apiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(apiHashType, apiTree.root, timestamp, apiTreeRootSignatures);

    const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
    const dataFeedData = [
      roles.airnode1.address,
      roles.airnode2.address,
      roles.airnode3.address,
      roles.airnode4.address,
      roles.airnode5.address,
    ].map((airnode) => {
      return {
        airnode,
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
      apiTree,
      apiTreeValues,
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
      const { roles, dapiDataRegistry, apiTree, apiTreeValues } = await helpers.loadFixture(deploy);

      const apiTreeRoot = apiTree.root;
      const [airnode, url] = apiTreeValues[2];
      const apiTreeProof = apiTree.getProof([airnode, url]);

      await expect(
        dapiDataRegistry
          .connect(roles.api3MarketContract)
          .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof)
      )
        .to.emit(dapiDataRegistry, 'RegisteredSignedApiUrl')
        .withArgs(airnode, url);
      expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
    });
  });

  describe('registerDataFeed', function () {
    context('Encoded data feed data is valid 32 bytes pairs', function () {
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
      it('registers beaconSet data feed dropping trailing data', async function () {
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
        const extraBytes32 = generateRandomBytes32();
        const extraAddress = generateRandomAddress();
        const encodedBeaconSetDataWithEvenNumberOfExtraBytes32 = hre.ethers.utils.hexConcat([
          encodedBeaconSetData,
          extraBytes32,
          extraBytes32,
          extraBytes32,
          hre.ethers.utils.hexZeroPad(extraAddress, 32),
        ]);
        await expect(
          dapiDataRegistry
            .connect(roles.randomPerson)
            .registerDataFeed(encodedBeaconSetDataWithEvenNumberOfExtraBytes32)
        )
          .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
          .withArgs(beaconSetId, encodedBeaconSetData);
        expect(await dapiDataRegistry.dataFeedIdToData(beaconSetId)).to.deep.equal(encodedBeaconSetData);
      });
    });
    context('Encoded data feed data is not valid 32 bytes pairs', function () {
      it('reverts', async function () {
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
        const extraBytes32 = generateRandomBytes32();
        const encodedBeaconSetDataWithEvenNumberOfExtraBytes32 = hre.ethers.utils.hexConcat([
          encodedBeaconSetData,
          extraBytes32,
          extraBytes32,
          extraBytes32,
        ]);
        await expect(
          dapiDataRegistry
            .connect(roles.randomPerson)
            .registerDataFeed(encodedBeaconSetDataWithEvenNumberOfExtraBytes32)
        ).to.have.been.revertedWith('Invalid data feed data');
        const extraAddress = generateRandomAddress();
        const encodedBeaconSetDataWithExtraAddress = hre.ethers.utils.hexConcat([encodedBeaconSetData, extraAddress]);
        await expect(
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetDataWithExtraAddress)
        ).to.have.been.revertedWith('Invalid data feed data');
        expect(await dapiDataRegistry.dataFeedIdToData(beaconSetId)).to.deep.equal('0x');
      });
    });
  });

  describe('registerDapi', function () {
    it.only('registers a dAPI', async function () {
      const {
        roles,
        dapiDataRegistry,
        dataFeedData,
        dapiName,
        beaconSetId,
        dapiTreeRoot,
        dapiTreeProof,
        apiTree,
        apiTreeValues,
      } = await helpers.loadFixture(deploy);

      const { airnodes, templateIds } = dataFeedData.reduce(
        (acc, { airnode, templateId }) => ({
          airnodes: [...acc.airnodes, airnode],
          templateIds: [...acc.templateIds, templateId],
        }),
        { airnodes: [], templateIds: [] }
      );

      const apiTreeRoot = apiTree.root;
      await Promise.all(
        apiTreeValues.map(([airnode, url]) => {
          const apiTreeProof = apiTree.getProof([airnode, url]);
          return dapiDataRegistry
            .connect(roles.api3MarketContract)
            .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
        })
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
      const [dapiNames, dataFeedIds, updateParameters, dataFeedDatas, signedApiUrls] = await dapiDataRegistry.readDapis(
        0,
        dapisCount
      );
      expect(dapiNames).to.deep.equal([dapiName]);
      expect(dataFeedIds).to.deep.equal([beaconSetId]);
      expect(updateParameters[0].deviationThresholdInPercentage).to.deep.equal(deviationThresholdInPercentage);
      expect(updateParameters[0].deviationReference).to.deep.equal(deviationReference);
      expect(updateParameters[0].heartbeatInterval).to.deep.equal(heartbeatInterval);
      expect(dataFeedDatas).to.deep.equal([encodedBeaconSetData]);
      expect(signedApiUrls).to.deep.equal([apiTreeValues.map(([, url]) => url)]);
    });
  });
});

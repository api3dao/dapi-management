const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const { generateRandomBytes32, generateRandomAddress, signData, deriveRootRole, deriveRole } = require('./test-utils');

describe('Api3Market', function () {
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
      'hashRegistryOwner',
      'apiRootSigner1',
      'apiRootSigner2',
      'apiRootSigner3',
      'dapiRootSigner1',
      'dapiRootSigner2',
      'dapiRootSigner3',
      'priceRootSigner1',
      'priceRootSigner2',
      'priceRootSigner3',
      'airnode1',
      'airnode2',
      'airnode3',
      'airnode4',
      'airnode5',
      'randomPerson',
    ];
    const accounts = await hre.ethers.getSigners();
    const roles = roleNames.reduce((acc, roleName, index) => {
      return { ...acc, [roleName]: accounts[index] };
    }, {});

    const HashRegistry = await hre.ethers.getContractFactory('HashRegistry', roles.deployer);
    const hashRegistry = await HashRegistry.deploy();
    await hashRegistry.connect(roles.deployer).transferOwnership(roles.hashRegistryOwner.address);

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

    const dapiFallbackV2AdminRoleDescription = 'DapiFallbackV2 admin';
    const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
    const dapiFallbackV2 = await DapiFallbackV2.deploy(
      accessControlRegistry.address,
      dapiFallbackV2AdminRoleDescription,
      roles.manager.address,
      api3ServerV1.address,
      hashRegistry.address,
      dapiDataRegistry.address
    );

    const proxyFactoryFactory = await hre.ethers.getContractFactory('ProxyFactory', roles.deployer);
    const proxyFactory = await proxyFactoryFactory.deploy(api3ServerV1.address);

    const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);
    const api3Market = await Api3Market.deploy(
      hashRegistry.address,
      dapiDataRegistry.address,
      dapiFallbackV2.address,
      proxyFactory.address,
      api3ServerV1.address
    );

    // Set up access control and roles
    const rootRole = deriveRootRole(roles.manager.address);

    const api3ServerV1AdminRole = deriveRole(rootRole, api3ServerV1AdminRoleDescription);
    const dapiNameSetterRoleDescription = await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION();
    const dapiNameSetterRole = deriveRole(api3ServerV1AdminRole, dapiNameSetterRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(api3ServerV1AdminRole, dapiNameSetterRoleDescription);
    await accessControlRegistry.connect(roles.manager).grantRole(dapiNameSetterRole, dapiDataRegistry.address);

    const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);
    const dapiAdderRoleDescription = await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION();
    const dapiAdderRole = deriveRole(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
    await accessControlRegistry.connect(roles.manager).grantRole(dapiAdderRole, api3Market.address);

    // Set up Merkle trees
    const timestamp = Math.floor(Date.now() / 1000);
    const chainId = (await hashRegistry.provider.getNetwork()).chainId;

    // Signed API URL Merkle tree
    const baseUrl = 'https://example.com/';
    const apiTreeValues = [
      [roles.airnode1.address, baseUrl + generateRandomString(10)],
      [roles.airnode2.address, baseUrl + generateRandomString(15)],
      [roles.airnode3.address, baseUrl + generateRandomString(10)],
      [roles.airnode4.address, baseUrl + generateRandomString(5)],
      [roles.airnode5.address, baseUrl + generateRandomString(20)],
    ];
    const apiTree = StandardMerkleTree.of(apiTreeValues, ['address', 'string']);
    const apiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle tree root']);
    const apiTreeRootSigners = [roles.apiRootSigner1, roles.apiRootSigner2, roles.apiRootSigner3];
    const apiMessage = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [apiHashType, apiTree.root, timestamp])
    );
    const apiTreeRootSignatures = await Promise.all(
      apiTreeRootSigners.map(async (rootSigner) => await rootSigner.signMessage(apiMessage))
    );
    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      apiHashType,
      apiTreeRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(apiHashType, apiTree.root, timestamp, apiTreeRootSignatures);

    // dAPI management Merkle tree
    const dapiNamesWithSponsorWallets = [
      ['API3/USD', generateRandomAddress()],
      ['BTC/USD', generateRandomAddress()],
      ['ETH/USD', generateRandomAddress()],
      ['MATIC/USD', generateRandomAddress()],
      ['UNI/USD', generateRandomAddress()],
    ];
    const dataFeeds = dapiNamesWithSponsorWallets.map(() =>
      [roles.airnode1, roles.airnode2, roles.airnode3, roles.airnode4, roles.airnode5].map((airnode) => ({
        airnode,
        templateId: generateRandomBytes32(),
      }))
    );
    const dapiTreeValues = dapiNamesWithSponsorWallets.map(([dapiName, sponsorWallet], index) => {
      const beaconIds = dataFeeds[index].map(({ airnode, templateId }) =>
        hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode.address, templateId])
      );

      const beaconSetId = hre.ethers.utils.keccak256(
        hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds])
      );
      return [hre.ethers.utils.formatBytes32String(dapiName), beaconSetId, sponsorWallet];
    });
    const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
    const dapiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
    const dapiTreeRootSigners = [roles.dapiRootSigner1, roles.dapiRootSigner2, roles.dapiRootSigner3];
    const dapiMessages = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [dapiHashType, dapiTree.root, timestamp])
    );
    const dapiTreeRootSignatures = await Promise.all(
      dapiTreeRootSigners.map(async (rootSigner) => await rootSigner.signMessage(dapiMessages))
    );
    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      dapiHashType,
      dapiTreeRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(dapiHashType, dapiTree.root, timestamp, dapiTreeRootSignatures);

    // dAPI pricing Merkle tree
    const duration = 7776000; // 90 days in seconds
    const price = hre.ethers.utils.parseEther('5.2');
    const deviationThresholdInPercentage = hre.ethers.utils.parseUnits('1', 6); // 1e6 represents 1%
    const deviationReference = 0;
    const heartbeatInterval = 86400; // 1 day in seconds
    const updateParams = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
    );
    const updateParamsDowngrade = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage * 2, deviationReference, heartbeatInterval]
    );
    const priceTreeValues = dapiNamesWithSponsorWallets
      .map(([dapiName]) => [
        [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParams, duration, price],
        [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParamsDowngrade, duration * 2, price.div(2)],
      ])
      .flat();
    const priceTree = StandardMerkleTree.of(priceTreeValues, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
    const priceHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI pricing Merkle tree root']);
    const priceRootSigners = [roles.priceRootSigner1, roles.priceRootSigner2, roles.priceRootSigner3];
    const priceMessage = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [priceHashType, priceTree.root, timestamp])
    );
    const priceSignatures = await Promise.all(
      priceRootSigners.map(async (rootSigner) => await rootSigner.signMessage(priceMessage))
    );
    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      priceHashType,
      priceRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(priceHashType, priceTree.root, timestamp, priceSignatures);

    return {
      roles,
      hashRegistry,
      dapiDataRegistry,
      dapiFallbackV2,
      proxyFactory,
      api3ServerV1,
      api3Market,
      apiTreeValues,
      apiTree,
      dataFeeds,
      dapiTreeValues,
      dapiTree,
      priceTreeValues,
      priceTree,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const { hashRegistry, dapiDataRegistry, dapiFallbackV2, proxyFactory, api3ServerV1, api3Market } =
        await helpers.loadFixture(deploy);
      expect(await api3Market.hashRegistry()).to.equal(hashRegistry.address);
      expect(await api3Market.dapiDataRegistry()).to.equal(dapiDataRegistry.address);
      expect(await api3Market.dapiFallbackV2()).to.equal(dapiFallbackV2.address);
      expect(await api3Market.proxyFactory()).to.equal(proxyFactory.address);
      expect(await api3Market.api3ServerV1()).to.equal(api3ServerV1.address);
    });
  });

  describe('buyDapi', function () {
    it.only('buys a dAPI subscription', async function () {
      const {
        roles,
        api3Market,
        proxyFactory,
        apiTreeValues,
        apiTree,
        dataFeeds,
        dapiTreeValues,
        dapiTree,
        priceTreeValues,
        priceTree,
      } = await helpers.loadFixture(deploy);

      const apiTreeRoot = apiTree.root;
      const apiTreeProofs = apiTreeValues.map(([airnode, url]) => apiTree.getProof([airnode, url]));

      const randomIndex = Math.floor(Math.random() * dapiTreeValues.length);
      const [dapiName, dataFeedId, sponsorWallet] = dapiTreeValues[randomIndex];
      const dapiTreeRoot = dapiTree.root;
      const dapiTreeProof = dapiTree.getProof([dapiName, dataFeedId, sponsorWallet]);

      const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 2];
      const priceTreeRoot = priceTree.root;
      const priceTreeProof = priceTree.getProof([dapiName, chainId, updateParams, duration, price]);

      const dapi = {
        name: dapiName,
        sponsorWallet,
        price,
        duration,
        updateParams,
      };

      const beacons = await Promise.all(
        dataFeeds[randomIndex].map(async ({ airnode, templateId }, index) => {
          const timestamp = await helpers.time.latest();
          const decodedData = Math.floor(Math.random() * 200 - 100);
          const data = hre.ethers.utils.defaultAbiCoder.encode(['int256'], [decodedData]);
          return {
            airnode: airnode.address,
            templateId,
            timestamp,
            data,
            signature: await signData(airnode, templateId, timestamp, data),
            url: apiTreeValues[index][1],
          };
        })
      );

      const dapiProxyAddress = await proxyFactory.computeDapiProxyAddress(dapiName, '0x');

      const args = {
        dapi,
        beacons,
        signedApiUrlRoot: apiTreeRoot,
        signedApiUrlProofs: apiTreeProofs,
        dapiRoot: dapiTreeRoot,
        dapiProof: dapiTreeProof,
        priceRoot: priceTreeRoot,
        priceProof: priceTreeProof,
      };

      const value = hre.ethers.utils.parseEther('5.2');
      await expect(api3Market.connect(roles.randomPerson).buyDapi(args, { value }))
        .to.emit(api3Market, 'BoughtDapi')
        .withArgs(
          dapiName,
          dataFeedId,
          dapiProxyAddress,
          price,
          duration,
          updateParams,
          value,
          roles.randomPerson.address
        );

      // TODO: more checks like if beacons were successfully updated

      const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber())).timestamp;
      const futureNow = now + duration / 2;
      await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

      // Downgrade from the middle of current subscription
      const [, , downgradeUpdateParams, downgradeDuration, downgradePrice] = priceTreeValues[randomIndex * 2 + 1];
      const downgradePriceTreeProof = priceTree.getProof([
        dapiName,
        chainId,
        downgradeUpdateParams,
        downgradeDuration,
        downgradePrice,
      ]);
      const downgradeDapi = {
        name: dapiName,
        sponsorWallet,
        price: downgradePrice,
        duration: downgradeDuration,
        updateParams: downgradeUpdateParams,
      };

      const downgradeValue = hre.ethers.utils.parseEther('2.6');
      const expectedPrice = downgradeValue.sub(downgradePrice.mul(duration / 2).div(downgradeDuration));
      const expectedDuration = downgradeDuration - duration / 2;
      await expect(
        api3Market
          .connect(roles.randomPerson)
          .buyDapi({ ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof }, { value: downgradeValue })
      )
        .to.emit(api3Market, 'BoughtDapi')
        .withArgs(
          dapiName,
          dataFeedId,
          dapiProxyAddress,
          expectedPrice,
          expectedDuration,
          downgradeUpdateParams,
          value.add(downgradeValue), // sponsorWallet balance
          roles.randomPerson.address
        );
    });
  });
});

const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const {
  generateRandomBytes32,
  generateRandomAddress,
  deriveRootRole,
  deriveRole,
  generateRandomBytes,
  signData,
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

  async function updateBeaconSet(roles, api3ServerV1, beacons, decodedData, timestamp) {
    if (!timestamp) {
      timestamp = await helpers.time.latest();
    }
    const data = hre.ethers.utils.defaultAbiCoder.encode(['int256'], [decodedData]);
    const signatures = await Promise.all(
      beacons.map(async (beacon) => {
        return signData(beacon.airnode, beacon.templateId, timestamp, data);
      })
    );
    const updateBeaconsCalldata = signatures.map((signature, index) => {
      const beacon = beacons[index];
      return api3ServerV1.interface.encodeFunctionData('updateBeaconWithSignedData', [
        beacon.airnode.address,
        beacon.templateId,
        timestamp,
        data,
        signature,
      ]);
    });
    const beaconIds = beacons.map((beacon) => {
      return beacon.beaconId;
    });
    const updateBeaconSetCalldata = [
      ...updateBeaconsCalldata,
      api3ServerV1.interface.encodeFunctionData('updateBeaconSetWithBeacons', [beaconIds]),
    ];
    await api3ServerV1.connect(roles.randomPerson).multicall(updateBeaconSetCalldata);
  }

  const deploy = async () => {
    const roleNames = [
      'deployer',
      'manager',
      'owner',
      'dapiFallbackV2',
      'api3MarketContract',
      'rootSigner1',
      'rootSigner2',
      'rootSigner3',
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
    const dapiAdderRoleDescription = await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION();
    const dapiAdderRole = deriveRole(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
    const dapiRemoverRoleDescription = await dapiDataRegistry.DAPI_REMOVER_ROLE_DESCRIPTION();
    const dapiRemoverRole = deriveRole(dapiDataRegistryAdminRole, dapiRemoverRoleDescription);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiAdderRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, dapiRemoverRoleDescription);

    await accessControlRegistry.connect(roles.manager).grantRole(dapiAdderRole, roles.api3MarketContract.address);
    await accessControlRegistry.connect(roles.manager).grantRole(dapiAdderRole, roles.dapiFallbackV2.address);
    await accessControlRegistry.connect(roles.manager).grantRole(dapiRemoverRole, roles.dapiFallbackV2.address);

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
    const rootSigners = [roles.rootSigner1, roles.rootSigner2, roles.rootSigner3];
    const apiMessage = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [apiHashType, apiTree.root, timestamp])
    );
    const apiTreeRootSignatures = await Promise.all(
      rootSigners.map(async (rootSigner) => await rootSigner.signMessage(apiMessage))
    );
    await hashRegistry.connect(roles.owner).setupSigners(
      apiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
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
    const dapiMessage = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [dapiHashType, dapiTree.root, timestamp])
    );
    const dapiTreeRootSignatures = await Promise.all(
      rootSigners.map(async (rootSigner) => await rootSigner.signMessage(dapiMessage))
    );
    await hashRegistry.connect(roles.owner).setupSigners(
      dapiHashType,
      rootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(dapiHashType, dapiTree.root, timestamp, dapiTreeRootSignatures);

    return {
      roles,
      dapiDataRegistryAdminRole,
      dapiAdderRole,
      dapiRemoverRole,
      accessControlRegistry,
      dapiDataRegistry,
      hashRegistry,
      api3ServerV1,
      dapiDataRegistryAdminRoleDescription,
      apiTree,
      apiTreeValues,
      dataFeeds,
      dapiTree,
      dapiTreeValues,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const {
        roles,
        dapiAdderRole,
        dapiRemoverRole,
        accessControlRegistry,
        dapiDataRegistry,
        hashRegistry,
        api3ServerV1,
        dapiDataRegistryAdminRoleDescription,
      } = await helpers.loadFixture(deploy);
      expect(await dapiDataRegistry.accessControlRegistry()).to.equal(accessControlRegistry.address);
      expect(await dapiDataRegistry.adminRoleDescription()).to.equal(dapiDataRegistryAdminRoleDescription);
      expect(await dapiDataRegistry.manager()).to.equal(roles.manager.address);
      expect(await dapiDataRegistry.dapiAdderRole()).to.equal(dapiAdderRole);
      expect(await dapiDataRegistry.dapiRemoverRole()).to.equal(dapiRemoverRole);
      expect(await dapiDataRegistry.hashRegistry()).to.equal(hashRegistry.address);
      expect(await dapiDataRegistry.api3ServerV1()).to.equal(api3ServerV1.address);
    });
  });

  describe('registerAirnodeSignedApiUrl', function () {
    context('Airnode is not zero', function () {
      context('Root has been registered', function () {
        context('Proof is valid', function () {
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

            // If try to register same URL for same Airnode then no update nor event emitted
            await expect(
              dapiDataRegistry
                .connect(roles.api3MarketContract)
                .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof)
            ).to.have.not.emit(dapiDataRegistry, 'RegisteredSignedApiUrl');
            expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
          });
        });
        context('Proof is not valid', function () {
          it('reverts', async function () {
            const { roles, dapiDataRegistry, apiTree, apiTreeValues } = await helpers.loadFixture(deploy);

            const apiTreeRoot = apiTree.root;
            const [airnode, url] = apiTreeValues[2];

            await expect(
              dapiDataRegistry
                .connect(roles.api3MarketContract)
                .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, [
                  generateRandomBytes32(),
                  generateRandomBytes32(),
                ])
            ).to.be.revertedWith('Invalid proof');
          });
        });
      });
      context('Root has not been registered', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry, apiTree, apiTreeValues } = await helpers.loadFixture(deploy);

          const [airnode, url] = apiTreeValues[2];
          const apiTreeProof = apiTree.getProof([airnode, url]);

          await expect(
            dapiDataRegistry
              .connect(roles.api3MarketContract)
              .registerAirnodeSignedApiUrl(airnode, url, generateRandomBytes32(), apiTreeProof)
          ).to.be.revertedWith('Root has not been registered');
        });
      });
    });
    context('Airnode is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry
            .connect(roles.api3MarketContract)
            .registerAirnodeSignedApiUrl(
              hre.ethers.constants.AddressZero,
              generateRandomBytes(20),
              generateRandomBytes32(),
              [generateRandomBytes32(), generateRandomBytes32()]
            )
        ).to.be.revertedWith('Airnode is zero');
      });
    });
  });

  describe('registerDataFeed', function () {
    context('Encoded data feed is valid address and bytes32 pairs', function () {
      context('Encoded data feed is valid 32 bytes pairs', function () {
        it('registers beacon data feed', async function () {
          const { roles, dapiDataRegistry, dataFeeds } = await helpers.loadFixture(deploy);

          const [dataFeed] = dataFeeds;
          const encodedBeaconData = hre.ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes32'],
            [dataFeed[0].airnode.address, dataFeed[0].templateId]
          );
          const dataFeedId = hre.ethers.utils.solidityKeccak256(
            ['address', 'bytes32'],
            [dataFeed[0].airnode.address, dataFeed[0].templateId]
          );

          await expect(dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconData))
            .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
            .withArgs(dataFeedId, encodedBeaconData);
          expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconData);
        });
        it.only('registers beaconSet data feed', async function () {
          const { roles, dapiDataRegistry, dataFeeds, dapiTreeValues } = await helpers.loadFixture(deploy);

          const [dataFeed] = dataFeeds;
          const [[, beaconSetId]] = dapiTreeValues;
          const { airnodes, templateIds } = dataFeed.reduce(
            (acc, { airnode, templateId }) => ({
              airnodes: [...acc.airnodes, airnode.address],
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
          expect(await dapiDataRegistry.dataFeeds(beaconSetId)).to.deep.equal(encodedBeaconSetData);

          // If try to register same data feed data for same data feed ID then no update nor event emitted
          await expect(
            dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData)
          ).to.have.not.emit(dapiDataRegistry, 'RegisteredDataFeed');
          expect(await dapiDataRegistry.dataFeeds(beaconSetId)).to.deep.equal(encodedBeaconSetData);
        });
      });
      context('Encoded data feed is not valid 32 bytes pairs', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry, dataFeeds, dapiTreeValues } = await helpers.loadFixture(deploy);

          const [dataFeed] = dataFeeds;
          const [[, beaconSetId]] = dapiTreeValues;
          const { airnodes, templateIds } = dataFeed.reduce(
            (acc, { airnode, templateId }) => ({
              airnodes: [...acc.airnodes, airnode.address],
              templateIds: [...acc.templateIds, templateId],
            }),
            { airnodes: [], templateIds: [] }
          );
          const encodedBeaconSetData = hre.ethers.utils.defaultAbiCoder.encode(
            ['address[]', 'bytes32[]'],
            [airnodes, templateIds]
          );
          await expect(
            dapiDataRegistry
              .connect(roles.randomPerson)
              .registerDataFeed(hre.ethers.utils.hexConcat([encodedBeaconSetData, hre.ethers.utils.hexZeroPad(1, 32)]))
          ).to.have.been.revertedWith('Invalid data feed');
          await expect(
            dapiDataRegistry
              .connect(roles.randomPerson)
              .registerDataFeed(hre.ethers.utils.hexConcat([encodedBeaconSetData, generateRandomBytes32()]))
          ).to.have.been.revertedWith('Invalid data feed');
          await expect(
            dapiDataRegistry
              .connect(roles.randomPerson)
              .registerDataFeed(
                hre.ethers.utils.hexConcat([
                  encodedBeaconSetData,
                  hre.ethers.utils.hexZeroPad(generateRandomAddress, 32),
                ])
              )
          ).to.have.been.revertedWith('Invalid data feed');

          expect(await dapiDataRegistry.dataFeeds(beaconSetId)).to.deep.equal('0x');
        });
      });
    });
    context('Encoded data feed is not valid address and bytes32 pairs', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        const invalidDataFeed1 = hre.ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address'],
          [generateRandomBytes32(), generateRandomAddress()]
        );
        const invalidDataFeed2 = hre.ethers.utils.defaultAbiCoder.encode(
          ['address', 'string'],
          [generateRandomAddress(), generateRandomBytes(32)]
        );
        const invalidDataFeed3 = hre.ethers.utils.defaultAbiCoder.encode(
          ['bytes32[]', 'bytes32[]'],
          [
            [generateRandomBytes32(), generateRandomBytes32()],
            [generateRandomBytes32(), generateRandomBytes32()],
          ]
        );
        const invalidDataFeed4 = hre.ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes32'],
          [generateRandomAddress(), generateRandomBytes32()]
        );
        const invalidDataFeed5 = '0x';

        await expect(
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(invalidDataFeed1)
        ).to.be.revertedWithoutReason();
        await expect(
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(invalidDataFeed2)
        ).to.be.revertedWithoutReason();
        await expect(
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(invalidDataFeed3)
        ).to.be.revertedWithoutReason();
        await expect(
          dapiDataRegistry
            .connect(roles.randomPerson)
            .registerDataFeed(hre.ethers.utils.hexConcat([invalidDataFeed4, 1]))
        ).to.be.revertedWithoutReason();
        await expect(
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(invalidDataFeed5)
        ).to.be.have.been.revertedWith('Data feed is empty');
      });
    });
  });

  describe('addDapi', function () {
    context('dAPI name is not zero', function () {
      context('Data feed ID is not zero', function () {
        context('Sponsor wallet is not zero', function () {
          context('Sender is manager or needs dAPI adder role', function () {
            context('Root has been registered', function () {
              context('Data feed ID has been registered', function () {
                context('Proof is valid', function () {
                  it('adds a dAPI', async function () {
                    const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTree, dapiTreeValues } =
                      await helpers.loadFixture(deploy);

                    const apiTreeRoot = apiTree.root;
                    await Promise.all(
                      apiTreeValues.map(([airnode, url]) => {
                        const apiTreeProof = apiTree.getProof([airnode, url]);
                        return dapiDataRegistry
                          .connect(roles.api3MarketContract)
                          .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
                      })
                    );

                    const [dataFeed] = dataFeeds;
                    const { airnodes, templateIds } = dataFeed.reduce(
                      (acc, { airnode, templateId }) => ({
                        airnodes: [...acc.airnodes, airnode.address],
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

                    const [dapiTreeValue] = dapiTreeValues;
                    const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                    await expect(
                      dapiDataRegistry
                        .connect(roles.api3MarketContract)
                        .addDapi(
                          dapiName,
                          beaconSetId,
                          sponsorWallet,
                          deviationThresholdInPercentage,
                          deviationReference,
                          heartbeatInterval,
                          dapiTree.root,
                          dapiTree.getProof(dapiTreeValue)
                        )
                    )
                      .to.emit(dapiDataRegistry, 'AddedDapi')
                      .withArgs(
                        dapiName,
                        beaconSetId,
                        sponsorWallet,
                        deviationThresholdInPercentage,
                        deviationReference,
                        heartbeatInterval
                      );

                    const dapisCount = await dapiDataRegistry.dapisCount();
                    expect(dapisCount).to.equal(1);
                    const [updateParameters, dataFeedValue, encodedDataFeed, signedApiUrls] =
                      await dapiDataRegistry.readDapiWithName(dapiName);
                    expect(updateParameters.deviationThresholdInPercentage).to.equal(deviationThresholdInPercentage);
                    expect(updateParameters.deviationReference).to.equal(deviationReference);
                    expect(updateParameters.heartbeatInterval).to.equal(heartbeatInterval);
                    expect(dataFeedValue).to.deep.equal([hre.ethers.constants.Zero, 0]);
                    expect(encodedDataFeed).to.deep.equal(encodedBeaconSetData);
                    const [decodedAirnodes, decodedTemplateIds] = hre.ethers.utils.defaultAbiCoder.decode(
                      ['address[]', 'bytes32[]'],
                      encodedDataFeed
                    );
                    const beaconIds = decodedAirnodes.map((airnode, index) =>
                      hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode, decodedTemplateIds[index]])
                    );
                    expect(
                      hre.ethers.utils.keccak256(hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]))
                    ).to.deep.equal(beaconSetId);
                    expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));

                    // dapiFallbackV2 was also granted the dAPI adder role
                    await expect(
                      dapiDataRegistry
                        .connect(roles.dapiFallbackV2)
                        .addDapi(
                          dapiName,
                          beaconSetId,
                          sponsorWallet,
                          deviationThresholdInPercentage,
                          deviationReference,
                          heartbeatInterval,
                          dapiTree.root,
                          dapiTree.getProof(dapiTreeValue)
                        )
                    )
                      .to.emit(dapiDataRegistry, 'AddedDapi')
                      .withArgs(
                        dapiName,
                        beaconSetId,
                        sponsorWallet,
                        deviationThresholdInPercentage,
                        deviationReference,
                        heartbeatInterval
                      );
                  });
                });
                context('Proof is not valid', function () {
                  it('reverts', async function () {
                    const { roles, dapiDataRegistry, dataFeeds, dapiTree, dapiTreeValues } = await helpers.loadFixture(
                      deploy
                    );

                    const [dataFeed] = dataFeeds;
                    const { airnodes, templateIds } = dataFeed.reduce(
                      (acc, { airnode, templateId }) => ({
                        airnodes: [...acc.airnodes, airnode.address],
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

                    const [dapiTreeValue] = dapiTreeValues;
                    const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                    await expect(
                      dapiDataRegistry
                        .connect(roles.api3MarketContract)
                        .addDapi(
                          dapiName,
                          beaconSetId,
                          sponsorWallet,
                          deviationThresholdInPercentage,
                          deviationReference,
                          heartbeatInterval,
                          dapiTree.root,
                          [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                        )
                    ).to.be.revertedWith('Invalid proof');
                  });
                });
              });
              context('Data feed ID has not been registered', function () {
                it('reverts', async function () {
                  const { roles, dapiDataRegistry, dapiTree, dapiTreeValues } = await helpers.loadFixture(deploy);

                  const deviationThresholdInPercentage = hre.ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
                  const deviationReference = hre.ethers.constants.Zero; // Not used in Airseeker V1
                  const heartbeatInterval = hre.ethers.BigNumber.from(86400); // 24 hrs

                  const [dapiTreeValue] = dapiTreeValues;
                  const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                  await expect(
                    dapiDataRegistry.connect(roles.api3MarketContract).addDapi(
                      dapiName,
                      beaconSetId, // registerDataFeed() has not been called yet (dataFeeds() returns empty string)
                      sponsorWallet,
                      deviationThresholdInPercentage,
                      deviationReference,
                      heartbeatInterval,
                      dapiTree.root,
                      dapiTree.getProof(dapiTreeValue)
                    )
                  ).to.be.revertedWith('Data feed ID has not been registered');
                });
              });
            });
            context('Root has not been registered', function () {
              it('reverts', async function () {
                const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

                await expect(
                  dapiDataRegistry
                    .connect(roles.api3MarketContract)
                    .addDapi(
                      generateRandomBytes32(),
                      generateRandomBytes32(),
                      generateRandomAddress(),
                      hre.ethers.constants.Zero,
                      hre.ethers.constants.Zero,
                      hre.ethers.constants.Zero,
                      generateRandomBytes32(),
                      [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                    )
                ).to.be.revertedWith('Root has not been registered');
              });
            });
          });
          context('Sender is manager or needs dAPI adder role', function () {
            it('reverts', async function () {
              const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

              await expect(
                dapiDataRegistry
                  .connect(roles.randomPerson)
                  .addDapi(
                    generateRandomBytes32(),
                    generateRandomBytes32(),
                    generateRandomAddress(),
                    hre.ethers.constants.Zero,
                    hre.ethers.constants.Zero,
                    hre.ethers.constants.Zero,
                    generateRandomBytes32(),
                    [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                  )
              ).to.be.revertedWith('Sender is not manager or has dAPI adder role');
            });
          });
        });
        context('Sponsor wallet is zero', function () {
          it('reverts', async function () {
            const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

            await expect(
              dapiDataRegistry
                .connect(roles.api3MarketContract)
                .addDapi(
                  generateRandomBytes32(),
                  generateRandomBytes32(),
                  hre.ethers.constants.AddressZero,
                  hre.ethers.constants.Zero,
                  hre.ethers.constants.Zero,
                  hre.ethers.constants.Zero,
                  generateRandomBytes32(),
                  [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                )
            ).to.be.revertedWith('Sponsor wallet is zero');
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

          await expect(
            dapiDataRegistry
              .connect(roles.api3MarketContract)
              .addDapi(
                generateRandomBytes32(),
                hre.ethers.constants.HashZero,
                generateRandomAddress(),
                hre.ethers.constants.Zero,
                hre.ethers.constants.Zero,
                hre.ethers.constants.Zero,
                generateRandomBytes32(),
                [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
              )
          ).to.be.revertedWith('Data feed ID is zero');
        });
      });
    });
    context('dAPI name is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry
            .connect(roles.api3MarketContract)
            .addDapi(
              hre.ethers.constants.HashZero,
              generateRandomBytes32(),
              generateRandomAddress(),
              hre.ethers.constants.Zero,
              hre.ethers.constants.Zero,
              hre.ethers.constants.Zero,
              generateRandomBytes32(),
              [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
            )
        ).to.be.revertedWith('dAPI name is zero');
      });
    });
  });

  describe('updateDapiDataFeedId', function () {
    context('dAPI name is not zero', function () {
      context('Data feed ID is not zero', function () {
        context('Sponsor wallet is not zero', function () {
          context('dAPI name has been added', function () {
            context('Root has been registered', function () {
              context('Data feed ID has been registered', function () {
                context('Proof is valid', function () {
                  it('edits a dAPI', async function () {
                    const {
                      roles,
                      hashRegistry,
                      dapiDataRegistry,
                      apiTree,
                      apiTreeValues,
                      dataFeeds,
                      dapiTree,
                      dapiTreeValues,
                    } = await helpers.loadFixture(deploy);

                    const apiTreeRoot = apiTree.root;
                    await Promise.all(
                      apiTreeValues.map(([airnode, url]) => {
                        const apiTreeProof = apiTree.getProof([airnode, url]);
                        return dapiDataRegistry
                          .connect(roles.api3MarketContract)
                          .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
                      })
                    );

                    const [dataFeed] = dataFeeds;
                    const { airnodes, templateIds } = dataFeed.reduce(
                      (acc, { airnode, templateId }) => ({
                        airnodes: [...acc.airnodes, airnode.address],
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

                    const [dapiTreeValue] = dapiTreeValues;
                    const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                    await dapiDataRegistry
                      .connect(roles.api3MarketContract)
                      .addDapi(
                        dapiName,
                        beaconSetId,
                        sponsorWallet,
                        deviationThresholdInPercentage,
                        deviationReference,
                        heartbeatInterval,
                        dapiTree.root,
                        dapiTree.getProof(dapiTreeValue)
                      );

                    const [, ...templateIdsRest] = templateIds;
                    const newTemplateIds = [...templateIdsRest, generateRandomBytes32()];
                    const newEncodedBeaconSetData = hre.ethers.utils.defaultAbiCoder.encode(
                      ['address[]', 'bytes32[]'],
                      [airnodes, newTemplateIds]
                    );
                    await dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(newEncodedBeaconSetData);

                    const newBeaconIds = airnodes.map((airnode, index) =>
                      hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode, newTemplateIds[index]])
                    );
                    const newBeaconSetId = hre.ethers.utils.keccak256(
                      hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [newBeaconIds])
                    );
                    const newSponsorWallet = generateRandomAddress();

                    const newDapiTreeValues = [
                      ...dapiTreeValues.filter(([dn]) => dn != dapiName),
                      [dapiName, newBeaconSetId, newSponsorWallet],
                    ];

                    const newDapiTree = StandardMerkleTree.of(newDapiTreeValues, ['bytes32', 'bytes32', 'address']);
                    const newDapiTreeRoot = newDapiTree.root;
                    const dapiHashType = hre.ethers.utils.solidityKeccak256(
                      ['string'],
                      ['dAPI management Merkle tree root']
                    );

                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    const timestamp = Math.floor(Date.now() / 1000);
                    const dapiMessages = hre.ethers.utils.arrayify(
                      hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'bytes32', 'uint256'],
                        [dapiHashType, newDapiTreeRoot, timestamp]
                      )
                    );
                    const dapiTreeRootSignatures = await Promise.all(
                      [roles.rootSigner1, roles.rootSigner2, roles.rootSigner3].map(
                        async (rootSigner) => await rootSigner.signMessage(dapiMessages)
                      )
                    );
                    await hashRegistry.registerHash(dapiHashType, newDapiTreeRoot, timestamp, dapiTreeRootSignatures);

                    await expect(
                      dapiDataRegistry
                        .connect(roles.randomPerson)
                        .updateDapiDataFeedId(
                          dapiName,
                          newBeaconSetId,
                          newSponsorWallet,
                          newDapiTree.root,
                          newDapiTree.getProof([dapiName, newBeaconSetId, newSponsorWallet])
                        )
                    )
                      .to.emit(dapiDataRegistry, 'UpdatedDapiDataFeedId')
                      .withArgs(dapiName, newBeaconSetId, newSponsorWallet, roles.randomPerson.address);

                    const dapisCount = await dapiDataRegistry.dapisCount();
                    expect(dapisCount).to.equal(1);
                    const [updateParameters, dataFeedValue, encodedDataFeed, signedApiUrls] =
                      await dapiDataRegistry.readDapiWithName(dapiName);
                    expect(updateParameters.deviationThresholdInPercentage).to.equal(deviationThresholdInPercentage);
                    expect(updateParameters.deviationReference).to.equal(deviationReference);
                    expect(updateParameters.heartbeatInterval).to.equal(heartbeatInterval);
                    expect(dataFeedValue).to.deep.equal([hre.ethers.constants.Zero, 0]);
                    expect(encodedDataFeed).to.deep.equal(newEncodedBeaconSetData);
                    expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                  });
                });
                context('Proof is not valid', function () {
                  it('reverts', async function () {
                    const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTree, dapiTreeValues } =
                      await helpers.loadFixture(deploy);

                    const apiTreeRoot = apiTree.root;
                    await Promise.all(
                      apiTreeValues.map(([airnode, url]) => {
                        const apiTreeProof = apiTree.getProof([airnode, url]);
                        return dapiDataRegistry
                          .connect(roles.api3MarketContract)
                          .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
                      })
                    );

                    const [dataFeed] = dataFeeds;
                    const { airnodes, templateIds } = dataFeed.reduce(
                      (acc, { airnode, templateId }) => ({
                        airnodes: [...acc.airnodes, airnode.address],
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

                    const [dapiTreeValue] = dapiTreeValues;
                    const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                    await dapiDataRegistry
                      .connect(roles.api3MarketContract)
                      .addDapi(
                        dapiName,
                        beaconSetId,
                        sponsorWallet,
                        deviationThresholdInPercentage,
                        deviationReference,
                        heartbeatInterval,
                        dapiTree.root,
                        dapiTree.getProof(dapiTreeValue)
                      );

                    await expect(
                      dapiDataRegistry
                        .connect(roles.randomPerson)
                        .updateDapiDataFeedId(dapiName, beaconSetId, sponsorWallet, dapiTree.root, [
                          generateRandomBytes32(),
                          generateRandomBytes32(),
                          generateRandomBytes32(),
                        ])
                    ).to.be.revertedWith('Invalid proof');
                  });
                });
              });
              context('Data feed ID has not been registered', function () {
                it('reverts', async function () {
                  const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTree, dapiTreeValues } =
                    await helpers.loadFixture(deploy);

                  const apiTreeRoot = apiTree.root;
                  await Promise.all(
                    apiTreeValues.map(([airnode, url]) => {
                      const apiTreeProof = apiTree.getProof([airnode, url]);
                      return dapiDataRegistry
                        .connect(roles.api3MarketContract)
                        .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
                    })
                  );

                  const [dataFeed] = dataFeeds;
                  const { airnodes, templateIds } = dataFeed.reduce(
                    (acc, { airnode, templateId }) => ({
                      airnodes: [...acc.airnodes, airnode.address],
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

                  const [dapiTreeValue] = dapiTreeValues;
                  const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                  await dapiDataRegistry
                    .connect(roles.api3MarketContract)
                    .addDapi(
                      dapiName,
                      beaconSetId,
                      sponsorWallet,
                      deviationThresholdInPercentage,
                      deviationReference,
                      heartbeatInterval,
                      dapiTree.root,
                      dapiTree.getProof(dapiTreeValue)
                    );

                  await expect(
                    dapiDataRegistry.connect(roles.api3MarketContract).updateDapiDataFeedId(
                      dapiName,
                      generateRandomBytes32(), // registerDataFeed() has not been called for this data feed ID (dataFeeds() returns empty string)
                      sponsorWallet,
                      dapiTree.root,
                      dapiTree.getProof(dapiTreeValue)
                    )
                  ).to.be.revertedWith('Data feed ID has not been registered');
                });
              });
            });
            context('Root has not been registered', function () {
              it('reverts', async function () {
                const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTree, dapiTreeValues } =
                  await helpers.loadFixture(deploy);

                const apiTreeRoot = apiTree.root;
                await Promise.all(
                  apiTreeValues.map(([airnode, url]) => {
                    const apiTreeProof = apiTree.getProof([airnode, url]);
                    return dapiDataRegistry
                      .connect(roles.api3MarketContract)
                      .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
                  })
                );

                const [dataFeed] = dataFeeds;
                const { airnodes, templateIds } = dataFeed.reduce(
                  (acc, { airnode, templateId }) => ({
                    airnodes: [...acc.airnodes, airnode.address],
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

                const [dapiTreeValue] = dapiTreeValues;
                const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

                await dapiDataRegistry
                  .connect(roles.api3MarketContract)
                  .addDapi(
                    dapiName,
                    beaconSetId,
                    sponsorWallet,
                    deviationThresholdInPercentage,
                    deviationReference,
                    heartbeatInterval,
                    dapiTree.root,
                    dapiTree.getProof(dapiTreeValue)
                  );

                await expect(
                  dapiDataRegistry
                    .connect(roles.randomPerson)
                    .updateDapiDataFeedId(
                      dapiName,
                      beaconSetId,
                      sponsorWallet,
                      generateRandomBytes32(),
                      dapiTree.getProof(dapiTreeValue)
                    )
                ).to.be.revertedWith('Root has not been registered');
              });
            });
          });
          context('dAPI name has not been added', function () {
            it('reverts', async function () {
              const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

              await expect(
                dapiDataRegistry
                  .connect(roles.randomPerson)
                  .updateDapiDataFeedId(
                    generateRandomBytes32(),
                    generateRandomBytes32(),
                    generateRandomAddress(),
                    generateRandomBytes32(),
                    [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                  )
              ).to.be.revertedWith('dAPI name has not been added');
            });
          });
        });
        context('Sponsor wallet is zero', function () {
          it('reverts', async function () {
            const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

            await expect(
              dapiDataRegistry
                .connect(roles.randomPerson)
                .updateDapiDataFeedId(
                  generateRandomBytes32(),
                  generateRandomBytes32(),
                  hre.ethers.constants.AddressZero,
                  generateRandomBytes32(),
                  [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
                )
            ).to.be.revertedWith('Sponsor wallet is zero');
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

          await expect(
            dapiDataRegistry
              .connect(roles.randomPerson)
              .updateDapiDataFeedId(
                generateRandomBytes32(),
                hre.ethers.constants.HashZero,
                generateRandomAddress(),
                generateRandomBytes32(),
                [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
              )
          ).to.be.revertedWith('Data feed ID is zero');
        });
      });
    });
    context('dAPI name is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry
            .connect(roles.randomPerson)
            .updateDapiDataFeedId(
              hre.ethers.constants.HashZero,
              generateRandomBytes32(),
              generateRandomAddress(),
              generateRandomBytes32(),
              [generateRandomBytes32(), generateRandomBytes32(), generateRandomBytes32()]
            )
        ).to.be.revertedWith('dAPI name is zero');
      });
    });
  });

  describe('removeDapi', function () {
    context('dAPI name is not zero', function () {
      context('Sender is manager or needs dAPI remover role', function () {
        context('dAPI name has been added', function () {
          it('removes dAPI', async function () {
            const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTree, dapiTreeValues } =
              await helpers.loadFixture(deploy);

            const apiTreeRoot = apiTree.root;
            await Promise.all(
              apiTreeValues.map(([airnode, url]) => {
                const apiTreeProof = apiTree.getProof([airnode, url]);
                return dapiDataRegistry
                  .connect(roles.randomPerson)
                  .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
              })
            );

            const [dataFeed] = dataFeeds;
            const { airnodes, templateIds } = dataFeed.reduce(
              (acc, { airnode, templateId }) => ({
                airnodes: [...acc.airnodes, airnode.address],
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

            const [dapiTreeValue] = dapiTreeValues;
            const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;

            await dapiDataRegistry
              .connect(roles.api3MarketContract)
              .addDapi(
                dapiName,
                beaconSetId,
                sponsorWallet,
                deviationThresholdInPercentage,
                deviationReference,
                heartbeatInterval,
                dapiTree.root,
                dapiTree.getProof(dapiTreeValue)
              );

            await expect(dapiDataRegistry.connect(roles.dapiFallbackV2).removeDapi(dapiName))
              .to.emit(dapiDataRegistry, 'RemovedDapi')
              .withArgs(dapiName, roles.dapiFallbackV2.address);
          });
        });
        context('dAPI name has not been added', function () {
          it('reverts', async function () {
            const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

            await expect(
              dapiDataRegistry.connect(roles.dapiFallbackV2).removeDapi(generateRandomBytes32())
            ).to.be.revertedWith('dAPI name has not been added');
          });
        });
      });
      context('Sender is not manager or has dAPI remover role', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

          await expect(
            dapiDataRegistry.connect(roles.randomPerson).removeDapi(generateRandomBytes32())
          ).to.be.revertedWith('Sender is not manager or has dAPI remover role');
        });
      });
    });
    context('dAPI name is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry.connect(roles.dapiFallbackV2).removeDapi(hre.ethers.constants.HashZero)
        ).to.be.revertedWith('dAPI name has not been added');
      });
    });
  });

  describe('readDapiWithIndex', function () {
    it('reads all dAPIs', async function () {
      const { roles, dapiDataRegistry, api3ServerV1, apiTree, apiTreeValues, dataFeeds, dapiTreeValues, dapiTree } =
        await helpers.loadFixture(deploy);

      const apiTreeRoot = apiTree.root;
      await Promise.all(
        apiTreeValues.map(([airnode, url]) => {
          const apiTreeProof = apiTree.getProof([airnode, url]);
          return dapiDataRegistry
            .connect(roles.api3MarketContract)
            .registerAirnodeSignedApiUrl(airnode, url, apiTreeRoot, apiTreeProof);
        })
      );

      const encodedBeaconSets = dataFeeds.map((dataFeed) => {
        const { airnodes, templateIds } = dataFeed.reduce(
          (acc, { airnode, templateId }) => ({
            airnodes: [...acc.airnodes, airnode.address],
            templateIds: [...acc.templateIds, templateId],
          }),
          { airnodes: [], templateIds: [] }
        );
        return hre.ethers.utils.defaultAbiCoder.encode(['address[]', 'bytes32[]'], [airnodes, templateIds]);
      });
      await Promise.all(
        encodedBeaconSets.map((encodedBeaconSetData) =>
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData)
        )
      );

      const beaconSetValue = Math.floor(Math.random() * 200 - 100);
      const beaconSetTimestamp = await helpers.time.latest();
      const beaconSets = dataFeeds.map((beacons) =>
        beacons.map(({ airnode, templateId }) => {
          return {
            beaconId: hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode.address, templateId]),
            airnode,
            templateId,
          };
        })
      );
      await updateBeaconSet(roles, api3ServerV1, beaconSets.flat(), beaconSetValue, beaconSetTimestamp);
      await Promise.all(
        beaconSets.map((beaconSet) =>
          api3ServerV1.updateBeaconSetWithBeacons(beaconSet.map(({ beaconId }) => beaconId))
        )
      );

      const deviationThresholdInPercentage = hre.ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
      const deviationReference = hre.ethers.constants.Zero; // Not used in Airseeker V1
      const heartbeatInterval = hre.ethers.BigNumber.from(86400); // 24 hrs

      await Promise.all(
        dapiTreeValues.map((dapiTreeValue) => {
          const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;
          return dapiDataRegistry
            .connect(roles.api3MarketContract)
            .addDapi(
              dapiName,
              beaconSetId,
              sponsorWallet,
              deviationThresholdInPercentage,
              deviationReference,
              heartbeatInterval,
              dapiTree.root,
              dapiTree.getProof(dapiTreeValue)
            );
        })
      );

      const dapisCount = (await dapiDataRegistry.dapisCount()).toNumber();
      expect(dapisCount).to.equal(dapiTreeValues.length);

      for (let i = 0; i < dapisCount; i++) {
        const [dapiName, updateParameters, dataFeedValue, encodedDataFeed, signedApiUrls] =
          await dapiDataRegistry.readDapiWithIndex(i);

        expect(dapiName).to.equal(dapiTreeValues[i][0]);
        expect(updateParameters).to.deep.equal([deviationThresholdInPercentage, deviationReference, heartbeatInterval]);
        expect(dataFeedValue).to.deep.equal([beaconSetValue, beaconSetTimestamp]);
        expect(encodedDataFeed).to.deep.equal(encodedBeaconSets[i]);
        expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
      }

      // Invalid index
      const [dapiName, updateParameters, dataFeedValue, encodedDataFeed, signedApiUrls] =
        await dapiDataRegistry.readDapiWithIndex(dapisCount);

      expect(dapiName).to.equal(hre.ethers.constants.HashZero);
      expect(updateParameters).to.deep.equal([
        hre.ethers.constants.Zero,
        hre.ethers.constants.Zero,
        hre.ethers.constants.Zero,
      ]);
      expect(dataFeedValue).to.deep.equal([hre.ethers.constants.Zero, 0]);
      expect(encodedDataFeed).to.equal('0x');
      expect(signedApiUrls).to.deep.equal([]);
    });
  });
});

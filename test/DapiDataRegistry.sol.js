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
  generateRandomBytes,
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
    const apiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['Signed API URL Merkle root']);
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

    const dapiNamesWithSponsorWallets = [
      ['API3/USD', generateRandomAddress()],
      ['BTC/USD', generateRandomAddress()],
      ['ETH/USD', roles.sponsorWallet.address],
      ['MATIC/USD', generateRandomAddress()],
      ['UNI/USD', generateRandomAddress()],
    ];

    const dataFeeds = dapiNamesWithSponsorWallets.map(() =>
      [
        roles.airnode1.address,
        roles.airnode2.address,
        roles.airnode3.address,
        roles.airnode4.address,
        roles.airnode5.address,
      ].map((airnode) => ({
        airnode: airnode,
        templateId: generateRandomBytes32(),
      }))
    );

    const dapiTreeValues = dapiNamesWithSponsorWallets.map(([dapiName, sponsorWallet], index) => {
      const beaconIds = dataFeeds[index].map(({ airnode, templateId }) =>
        hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnode, templateId])
      );

      const beaconSetId = hre.ethers.utils.keccak256(
        hre.ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds])
      );
      return [hre.ethers.utils.formatBytes32String(dapiName), beaconSetId, sponsorWallet];
    });

    const dapiTree = StandardMerkleTree.of(dapiTreeValues, ['bytes32', 'bytes32', 'address']);
    const dapiTreeRoot = dapiTree.root;
    const dapiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
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
      dataFeeds,
      dapiTree,
      dapiTreeValues,
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
    context('Root is not zero', function () {
      context('Proof is not empty', function () {
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
      context('Proof is empty', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

          await expect(
            dapiDataRegistry
              .connect(roles.api3MarketContract)
              .registerAirnodeSignedApiUrl(
                generateRandomAddress(),
                generateRandomBytes(20),
                generateRandomBytes32(),
                []
              )
          ).to.be.revertedWith('Proof is empty');
        });
      });
    });
    context('Root is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry
            .connect(roles.api3MarketContract)
            .registerAirnodeSignedApiUrl(
              generateRandomAddress(),
              generateRandomBytes(20),
              hre.ethers.constants.HashZero,
              [generateRandomBytes32(), generateRandomBytes32()]
            )
        ).to.be.revertedWith('Root is zero');
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
            [dataFeed[0].airnode, dataFeed[0].templateId]
          );
          const dataFeedId = hre.ethers.utils.solidityKeccak256(
            ['address', 'bytes32'],
            [dataFeed[0].airnode, dataFeed[0].templateId]
          );

          await expect(dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconData))
            .to.emit(dapiDataRegistry, 'RegisteredDataFeed')
            .withArgs(dataFeedId, encodedBeaconData);
          expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconData);
        });
        it('registers beaconSet data feed', async function () {
          const { roles, dapiDataRegistry, dataFeeds, dapiTreeValues } = await helpers.loadFixture(deploy);

          const [dataFeed] = dataFeeds;
          const [[, beaconSetId]] = dapiTreeValues;
          const { airnodes, templateIds } = dataFeed.reduce(
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
              airnodes: [...acc.airnodes, airnode],
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
        ).to.be.revertedWithoutReason();
      });
    });
  });

  describe('addDapi', function () {
    context('Root is not zero', function () {
      context('Proof is not empty', function () {
        context('Sender is manager or needs Registrar role', function () {
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
                  const [dapiNames, updateParameters, encodedDataFeedsdataFeeds, signedApiUrls] =
                    await dapiDataRegistry.readDapis(0, dapisCount);
                  expect(dapiNames).to.deep.equal([dapiName]);
                  expect(updateParameters[0].deviationThresholdInPercentage).to.deep.equal(
                    deviationThresholdInPercentage
                  );
                  expect(updateParameters[0].deviationReference).to.deep.equal(deviationReference);
                  expect(updateParameters[0].heartbeatInterval).to.deep.equal(heartbeatInterval);
                  expect(encodedDataFeedsdataFeeds).to.deep.equal([encodedBeaconSetData]);
                  expect(signedApiUrls).to.deep.equal([apiTreeValues.map(([, url]) => url)]);
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
        context('Sender is manager or needs Registrar role', function () {
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
            ).to.be.revertedWith('Sender is not manager or needs Registrar role');
          });
        });
      });
      context('Proof is empty', function () {
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
                []
              )
          ).to.be.revertedWith('Proof is empty');
        });
      });
    });
    context('Root is not zero', function () {
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
              hre.ethers.constants.HashZero,
              []
            )
        ).to.be.revertedWith('Root is zero');
      });
    });
  });

  describe('removeDapi', function () {
    context('dAPI name is not zero', function () {
      context('Sender is manager or needs Registrar role', function () {
        context('dAPI name has been added', function () {
          it('removes dAPI', async function () {
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

            await expect(dapiDataRegistry.connect(roles.api3MarketContract).removeDapi(dapiName))
              .to.emit(dapiDataRegistry, 'RemovedDapi')
              .withArgs(dapiName, roles.api3MarketContract.address);
          });
        });
        context('dAPI name has not been added', function () {
          it('reverts', async function () {
            const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

            await expect(
              dapiDataRegistry.connect(roles.api3MarketContract).removeDapi(generateRandomBytes32())
            ).to.be.revertedWith('dAPI name has not been added');
          });
        });
      });
      context('Sender is not manager or needs Registrar role', function () {
        it('reverts', async function () {
          const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

          await expect(
            dapiDataRegistry.connect(roles.randomPerson).removeDapi(generateRandomBytes32())
          ).to.be.revertedWith('Sender is not manager or needs Registrar role');
        });
      });
    });
    context('dAPI name is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry } = await helpers.loadFixture(deploy);

        await expect(
          dapiDataRegistry.connect(roles.api3MarketContract).removeDapi(hre.ethers.constants.HashZero)
        ).to.be.revertedWith('dAPI name is zero');
      });
    });
  });

  describe('readDapis', function () {
    it('reads all dAPIs', async function () {
      const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTreeValues, dapiTree } =
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

      const encodedBeaconSetDatas = dataFeeds.map((dataFeed) => {
        const { airnodes, templateIds } = dataFeed.reduce(
          (acc, { airnode, templateId }) => ({
            airnodes: [...acc.airnodes, airnode],
            templateIds: [...acc.templateIds, templateId],
          }),
          { airnodes: [], templateIds: [] }
        );
        return hre.ethers.utils.defaultAbiCoder.encode(['address[]', 'bytes32[]'], [airnodes, templateIds]);
      });
      await Promise.all(
        encodedBeaconSetDatas.map((encodedBeaconSetData) =>
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData)
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

      const dapisCount = await dapiDataRegistry.dapisCount();
      const [dapiNames, updateParameters, encodedDataFeedsdataFeeds, signedApiUrls] = await dapiDataRegistry.readDapis(
        0,
        dapisCount
      );

      expect(dapiNames).to.deep.equal(dapiTreeValues.map(([dapiName]) => dapiName));
      expect(updateParameters).to.deep.equal(
        Array(dapiTreeValues.length).fill([deviationThresholdInPercentage, deviationReference, heartbeatInterval])
      );
      expect(encodedDataFeedsdataFeeds).to.deep.equal(encodedBeaconSetDatas);
      expect(signedApiUrls).to.deep.equal(Array(dapiTreeValues.length).fill(apiTreeValues.map(([, url]) => url)));

      const [emptyDapiNames, emptyUpdateParameters, emptyEncodedDataFeedsdataFeeds, emptySignedApiUrls] =
        await dapiDataRegistry.readDapis(dapisCount, dapisCount);
      expect(emptyDapiNames).to.deep.equal([]);
      expect(emptyUpdateParameters).to.deep.equal([]);
      expect(emptyEncodedDataFeedsdataFeeds).to.deep.equal([]);
      expect(emptySignedApiUrls).to.deep.equal([]);
    });
    it('reads all dAPIs paginated', async function () {
      const { roles, dapiDataRegistry, apiTree, apiTreeValues, dataFeeds, dapiTreeValues, dapiTree } =
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

      const encodedBeaconSetDatas = dataFeeds.map((dataFeed) => {
        const { airnodes, templateIds } = dataFeed.reduce(
          (acc, { airnode, templateId }) => ({
            airnodes: [...acc.airnodes, airnode],
            templateIds: [...acc.templateIds, templateId],
          }),
          { airnodes: [], templateIds: [] }
        );
        return hre.ethers.utils.defaultAbiCoder.encode(['address[]', 'bytes32[]'], [airnodes, templateIds]);
      });
      await Promise.all(
        encodedBeaconSetDatas.map((encodedBeaconSetData) =>
          dapiDataRegistry.connect(roles.randomPerson).registerDataFeed(encodedBeaconSetData)
        )
      );

      const deviationThresholdInPercentage = hre.ethers.BigNumber.from(HUNDRED_PERCENT / 50); // 2%
      const deviationReference = hre.ethers.constants.Zero; // Not used in Airseeker V1
      const heartbeatInterval = hre.ethers.BigNumber.from(86400); // 24 hrs

      const calldatas = dapiTreeValues.map((dapiTreeValue) => {
        const [dapiName, beaconSetId, sponsorWallet] = dapiTreeValue;
        return dapiDataRegistry.interface.encodeFunctionData('addDapi', [
          dapiName,
          beaconSetId,
          sponsorWallet,
          deviationThresholdInPercentage,
          deviationReference,
          heartbeatInterval,
          dapiTree.root,
          dapiTree.getProof(dapiTreeValue),
        ]);
      });
      await dapiDataRegistry.connect(roles.api3MarketContract).multicall(calldatas);

      const dapisCount = await dapiDataRegistry.dapisCount();
      for (let i = 0; i < dapisCount; i += 2) {
        const chunkSize = Math.min(2, dapisCount - i);
        const [dapiNames, updateParameters, encodedDataFeedsdataFeeds, signedApiUrls] =
          await dapiDataRegistry.readDapis(i, chunkSize);

        expect(dapiNames).to.deep.equal(dapiTreeValues.slice(i, i + chunkSize).map(([dapiName]) => dapiName));
        expect(updateParameters).to.deep.equal(
          Array(chunkSize).fill([deviationThresholdInPercentage, deviationReference, heartbeatInterval])
        );
        expect(encodedDataFeedsdataFeeds).to.deep.equal(encodedBeaconSetDatas.slice(i, i + chunkSize));
        expect(signedApiUrls).to.deep.equal(Array(chunkSize).fill(apiTreeValues.map(([, url]) => url)));
      }
    });
  });
});
const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const {
  generateRandomBytes32,
  generateRandomAddress,
  buildEIP712Domain,
  deriveRootRole,
  generateRandomBytes,
} = require('./test-utils');

describe('DapiFallbackV2', function () {
  const HUNDRED_PERCENT = 1e8;

  const deploy = async () => {
    const roleNames = [
      'deployer',
      'manager',
      'dapiFallbackV2Owner',
      'hashRegistryOwner',
      'accessControlRegistry',
      'dapiFallbackRootSigner1',
      'dapiFallbackRootSigner2',
      'dapiFallbackRootSigner3',
      'priceRootSigner1',
      'priceRootSigner2',
      'priceRootSigner3',
      'api3Market',
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

    const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
    const dapiFallbackV2 = await DapiFallbackV2.deploy(
      api3ServerV1.address,
      hashRegistry.address,
      dapiDataRegistry.address
    );
    await dapiFallbackV2.connect(roles.deployer).transferOwnership(roles.dapiFallbackV2Owner.address);

    const rootRole = deriveRootRole(roles.manager.address);

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
      .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiFallbackV2.address);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        await dapiDataRegistry.adminRole(),
        await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION()
      );
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        await dapiDataRegistry.adminRole(),
        await dapiDataRegistry.DAPI_REMOVER_ROLE_DESCRIPTION()
      );
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiDataRegistry.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await dapiDataRegistry.dapiAdderRole(), roles.api3Market.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await dapiDataRegistry.dapiAdderRole(), dapiFallbackV2.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await dapiDataRegistry.dapiRemoverRole(), dapiFallbackV2.address);

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

    const dapiName = 'API3/USD';
    const fallbackBeaconTemplateId = generateRandomBytes32();
    const fallbackBeaconId = hre.ethers.utils.solidityKeccak256(
      ['address', 'bytes32'],
      [roles.airnode1.address, fallbackBeaconTemplateId]
    );
    const fallbackSponsorWalletAddress = generateRandomAddress();

    const fallbackTreeEntry = [
      hre.ethers.utils.formatBytes32String(dapiName),
      fallbackBeaconId,
      fallbackSponsorWalletAddress,
    ];
    const fallbackTreeValues = [
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      fallbackTreeEntry,
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
    ];
    const fallbackTree = StandardMerkleTree.of(fallbackTreeValues, ['bytes32', 'bytes32', 'address']);
    const fallbackRoot = fallbackTree.root;
    const fallbackProof = fallbackTree.getProof(fallbackTreeEntry);

    const dapiFallbackHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI fallback Merkle tree root']);
    const fallbackValues = {
      hashType: dapiFallbackHashType,
      hash: fallbackRoot,
      timestamp,
    };
    const dapiFallbackRootSigners = [
      roles.dapiFallbackRootSigner1,
      roles.dapiFallbackRootSigner2,
      roles.dapiFallbackRootSigner3,
    ];
    const fallbackSignatures = await Promise.all(
      dapiFallbackRootSigners.map(async (rootSigner) => await rootSigner._signTypedData(domain, types, fallbackValues))
    );

    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      dapiFallbackHashType,
      dapiFallbackRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(dapiFallbackHashType, fallbackRoot, timestamp, fallbackSignatures);

    const duration = 7776000; // 90 days in seconds
    const price = hre.ethers.utils.parseEther('3');
    const deviationThresholdInPercentage = hre.ethers.utils.parseUnits('1', 6); // 1e6 represents 1%
    const heartbeatInterval = 86400; // 1 day in seconds
    const deviationReference = 0;

    const updateParams = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
    );

    const priceTreeEntry = [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParams, duration, price];
    const priceTreeValues = [
      [generateRandomBytes32(), 1, generateRandomBytes(), 2592000, hre.ethers.utils.parseEther('1')],
      [generateRandomBytes32(), 2, generateRandomBytes(), 2592001, hre.ethers.utils.parseEther('2')],
      priceTreeEntry,
      [generateRandomBytes32(), 3, generateRandomBytes(), 2592002, hre.ethers.utils.parseEther('4')],
      [generateRandomBytes32(), 4, generateRandomBytes(), 2592003, hre.ethers.utils.parseEther('5')],
    ];
    const priceTree = StandardMerkleTree.of(priceTreeValues, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
    const priceRoot = priceTree.root;
    const priceProof = priceTree.getProof(priceTreeEntry);

    const priceHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI pricing Merkle tree root']);
    const priceValues = {
      hashType: priceHashType,
      hash: priceRoot,
      timestamp,
    };
    const priceRootSigners = [roles.priceRootSigner1, roles.priceRootSigner2, roles.priceRootSigner3];
    const priceSignatures = await Promise.all(
      priceRootSigners.map(async (rootSigner) => await rootSigner._signTypedData(domain, types, priceValues))
    );

    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      priceHashType,
      priceRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(priceHashType, priceRoot, timestamp, priceSignatures);

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
    const dapiTreeRoot = dapiTree.root;
    const dapiHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI management Merkle tree root']);
    const dapiValues = {
      hashType: dapiHashType,
      hash: dapiTreeRoot,
      timestamp,
    };
    const dapiTreeRootSignatures = await Promise.all(
      dapiFallbackRootSigners.map(async (rootSigner) => await rootSigner._signTypedData(domain, types, dapiValues))
    );

    await hashRegistry.connect(roles.hashRegistryOwner).setupSigners(
      dapiHashType,
      dapiFallbackRootSigners.map((rootSigner) => rootSigner.address)
    );
    await hashRegistry.registerHash(dapiHashType, dapiTreeRoot, timestamp, dapiTreeRootSignatures);

    const executeDapiFallbackArgs = {
      dapiName: hre.ethers.utils.formatBytes32String(dapiName),
      dataFeedId: fallbackBeaconId,
      fallbackRoot: fallbackRoot,
      fallbackProof: fallbackProof,
      updateParams: updateParams,
      priceRoot: priceRoot,
      priceProof: priceProof,
      duration: duration,
      price: price,
      sponsorWallet: fallbackSponsorWalletAddress,
    };

    await roles.randomPerson.sendTransaction({
      to: dapiFallbackV2.address,
      value: hre.ethers.utils.parseEther('33'),
    });

    return {
      roles,
      api3ServerV1,
      dapiFallbackV2,
      hashRegistry,
      accessControlRegistry,
      dapiName,
      dapiFallbackHashType,
      fallbackBeaconTemplateId,
      fallbackBeaconId,
      fallbackSponsorWalletAddress,
      fallbackRoot,
      fallbackProof,
      fallbackSignatures,
      domain,
      types,
      timestamp,
      priceRoot,
      priceProof,
      priceSignatures,
      updateParams,
      duration,
      price,
      executeDapiFallbackArgs,
      dapiDataRegistry,
      dataFeeds,
      dapiTreeValues,
      dapiTree,
      dapiTreeRootSignatures,
    };
  };

  describe('constructor', function () {
    context('Address is not zero', function () {
      it('constructs', async function () {
        const { roles, api3ServerV1, dapiFallbackV2, hashRegistry } = await helpers.loadFixture(deploy);
        expect(await dapiFallbackV2.owner()).to.equal(roles.dapiFallbackV2Owner.address);
        expect(await dapiFallbackV2.api3ServerV1()).to.equal(api3ServerV1.address);
        expect(await dapiFallbackV2.hashRegistry()).to.equal(hashRegistry.address);
      });
    });
  });

  describe('withdraw', function () {
    context('Sender is the owner', function () {
      context('Recipient address is not zero', function () {
        context('Amount is not zero', function () {
          context('Contract have funds', function () {
            context('Low level call succeeds', function () {
              it('withdraws the requested amount', async function () {
                const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
                await expect(
                  dapiFallbackV2.connect(roles.dapiFallbackV2Owner).withdraw(hre.ethers.utils.parseEther('1'))
                )
                  .to.emit(dapiFallbackV2, 'Withdrawn')
                  .withArgs(
                    roles.dapiFallbackV2Owner.address,
                    hre.ethers.utils.parseEther('1'),
                    hre.ethers.utils.parseEther('32')
                  );
              });
            });
          });
          context('Contract does not have funds', function () {
            it('reverts', async function () {
              const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              await expect(
                dapiFallbackV2.connect(roles.dapiFallbackV2Owner).withdraw(hre.ethers.utils.parseEther('34'))
              ).to.be.revertedWith('Address: insufficient balance');
            });
          });
        });
        context('Amount is zero', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            await expect(dapiFallbackV2.connect(roles.dapiFallbackV2Owner).withdraw(0)).to.be.revertedWith(
              'Amount zero'
            );
          });
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).withdraw(hre.ethers.utils.parseEther('33'))
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('executeDapiFallback', function () {
    context('Dapi name is not zero', function () {
      context('Data feed ID is not zero', function () {
        context('Update params are not empty', function () {
          context('Duration is not zero', function () {
            context('Price is not zero', function () {
              context('Sponsor wallet address is not zero', function () {
                context('Update params does match', function () {
                  context('Data feed ID will be changed', function () {
                    context('Proof is not empty', function () {
                      context('Root is not zero', function () {
                        context('Tree has been registered', function () {
                          context('Valid tree proof', function () {
                            it('executes dAPI fallback', async function () {
                              const {
                                roles,
                                dapiFallbackV2,
                                dapiName,
                                fallbackBeaconId,
                                fallbackSponsorWalletAddress,
                                executeDapiFallbackArgs,
                                dapiDataRegistry,
                                dataFeeds,
                                dapiTree,
                                dapiTreeValues,
                              } = await helpers.loadFixture(deploy);
                              const initialBalanceOfDapiFallbackV2 = await hre.ethers.provider.getBalance(
                                dapiFallbackV2.address
                              );
                              const initialBalanceOfSponsor = await hre.ethers.provider.getBalance(
                                fallbackSponsorWalletAddress
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
                              const [, beaconSetId, sponsorWallet] = dapiTreeValue;
                              await dapiDataRegistry
                                .connect(roles.api3Market)
                                .addDapi(
                                  hre.ethers.utils.formatBytes32String(dapiName),
                                  beaconSetId,
                                  sponsorWallet,
                                  deviationThresholdInPercentage,
                                  deviationReference,
                                  heartbeatInterval,
                                  dapiTree.root,
                                  dapiTree.getProof(dapiTreeValue)
                                );
                              await expect(
                                dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                              )
                                .to.emit(dapiFallbackV2, 'ExecutedDapiFallback')
                                .withArgs(
                                  hre.ethers.utils.formatBytes32String(dapiName),
                                  fallbackBeaconId,
                                  roles.randomPerson.address
                                );
                              const finalBalanceOfSponsor = await hre.ethers.provider.getBalance(
                                fallbackSponsorWalletAddress
                              );
                              expect(finalBalanceOfSponsor.sub(initialBalanceOfSponsor)).to.equal(
                                hre.ethers.utils.parseEther('0.033333333333333333')
                              );
                              const finalBalanceOfDapiFallbackV2 = await hre.ethers.provider.getBalance(
                                dapiFallbackV2.address
                              );
                              expect(initialBalanceOfDapiFallbackV2.sub(finalBalanceOfDapiFallbackV2)).to.equal(
                                hre.ethers.utils.parseEther('0.033333333333333333')
                              );
                            });
                          });
                          context('Invalid tree proof', function () {
                            it('reverts', async function () {
                              const {
                                roles,
                                dapiFallbackV2,
                                dapiName,
                                fallbackBeaconId,
                                fallbackRoot,
                                updateParams,
                                priceRoot,
                                priceProof,
                                duration,
                                price,
                                fallbackSponsorWalletAddress,
                              } = await helpers.loadFixture(deploy);
                              const invalidFallbackTreeEntry = [
                                hre.ethers.utils.formatBytes32String('invalidFallbackProof'),
                                fallbackBeaconId,
                                fallbackSponsorWalletAddress,
                              ];
                              const invalidFallbackTreeValues = [
                                [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                                [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                                invalidFallbackTreeEntry,
                                [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                                [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                              ];
                              const invalidFallbackTree = StandardMerkleTree.of(invalidFallbackTreeValues, [
                                'bytes32',
                                'bytes32',
                                'address',
                              ]);
                              const invalidFallbackProof = invalidFallbackTree.getProof(invalidFallbackTreeEntry);
                              const executeDapiFallbackArgs = {
                                dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                                dataFeedId: fallbackBeaconId,
                                fallbackRoot: fallbackRoot,
                                fallbackProof: invalidFallbackProof,
                                updateParams: updateParams,
                                priceRoot: priceRoot,
                                priceProof: priceProof,
                                duration: duration,
                                price: price,
                                sponsorWallet: fallbackSponsorWalletAddress,
                              };
                              await expect(
                                dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                              ).to.be.revertedWith('Invalid tree proof');
                            });
                          });
                        });
                        context('Tree has not been registered', function () {
                          it('reverts', async function () {
                            const { roles, dapiFallbackV2, updateParams, priceRoot, priceProof, duration, price } =
                              await helpers.loadFixture(deploy);
                            const dapiName = 'API3/USD';
                            const fallbackBeaconTemplateId = generateRandomBytes32();
                            const fallbackBeaconId = hre.ethers.utils.solidityKeccak256(
                              ['address', 'bytes32'],
                              [roles.airnode1.address, fallbackBeaconTemplateId]
                            );
                            const fallbackSponsorWalletAddress = generateRandomAddress();
                            const fallbackTreeEntry = [
                              hre.ethers.utils.formatBytes32String(dapiName),
                              fallbackBeaconId,
                              fallbackSponsorWalletAddress,
                            ];
                            const fallbackTreeValues = [
                              [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                              [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                              fallbackTreeEntry,
                              [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                              [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
                            ];
                            const fallbackTree = StandardMerkleTree.of(fallbackTreeValues, [
                              'bytes32',
                              'bytes32',
                              'address',
                            ]);
                            const fallbackRoot = fallbackTree.root;
                            const fallbackProof = fallbackTree.getProof(fallbackTreeEntry);
                            const executeDapiFallbackArgs = {
                              dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                              dataFeedId: fallbackBeaconId,
                              fallbackRoot: fallbackRoot,
                              fallbackProof: fallbackProof,
                              updateParams: updateParams,
                              priceRoot: priceRoot,
                              priceProof: priceProof,
                              duration: duration,
                              price: price,
                              sponsorWallet: fallbackSponsorWalletAddress,
                            };
                            await expect(
                              dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                            ).to.be.revertedWith('Tree has not been registered');
                          });
                        });
                      });
                      context('Root is zero', function () {
                        it('reverts', async function () {
                          const {
                            roles,
                            dapiFallbackV2,
                            dapiName,
                            fallbackBeaconId,
                            fallbackProof,
                            updateParams,
                            priceProof,
                            duration,
                            price,
                            fallbackSponsorWalletAddress,
                          } = await helpers.loadFixture(deploy);
                          const zeroRoot = hre.ethers.constants.HashZero;
                          const executeDapiFallbackArgs = {
                            dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                            dataFeedId: fallbackBeaconId,
                            fallbackRoot: zeroRoot,
                            fallbackProof: fallbackProof,
                            updateParams: updateParams,
                            priceRoot: zeroRoot,
                            priceProof: priceProof,
                            duration: duration,
                            price: price,
                            sponsorWallet: fallbackSponsorWalletAddress,
                          };
                          await expect(
                            dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                          ).to.be.revertedWith('Root is zero');
                        });
                      });
                    });
                    context('Proof is empty', function () {
                      it('reverts', async function () {
                        const {
                          roles,
                          dapiFallbackV2,
                          dapiName,
                          fallbackBeaconId,
                          fallbackRoot,
                          updateParams,
                          priceRoot,
                          duration,
                          price,
                          fallbackSponsorWalletAddress,
                        } = await helpers.loadFixture(deploy);
                        const emptyProof = [];
                        const executeDapiFallbackArgs = {
                          dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                          dataFeedId: fallbackBeaconId,
                          fallbackRoot: fallbackRoot,
                          fallbackProof: emptyProof,
                          updateParams: updateParams,
                          priceRoot: priceRoot,
                          priceProof: emptyProof,
                          duration: duration,
                          price: price,
                          sponsorWallet: fallbackSponsorWalletAddress,
                        };
                        await expect(
                          dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                        ).to.be.revertedWith('Proof is empty');
                      });
                    });
                  });
                  context('Data feed ID will not be changed', function () {
                    it('reverts', async function () {
                      /*         const {
                    roles,
                    dapiFallbackV2,
                    dapiName,
                    fallbackBeaconId,
                    fallbackRoot,
                    fallbackProof,
                    updateParams,
                    priceRoot,
                    priceProof,
                    duration,
                    price,
                    fallbackSponsorWalletAddress,
                  } = await helpers.loadFixture(deploy);
                  const fallbackBeaconTemplateId = generateRandomBytes32();
                  const fallbackBeaconId = hre.ethers.utils.solidityKeccak256(
                    ['address', 'bytes32'],
                    [roles.airnode1.address, fallbackBeaconTemplateId]
                  );
                  const executeDapiFallbackArgs = {
                    dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                    beaconId: fallbackBeaconId,
                    fallbackRoot: fallbackRoot,
                    fallbackProof: fallbackProof,
                    updateParams: updateParams,
                    priceRoot: priceRoot,
                    priceProof: priceProof,
                    duration: duration,
                    price: price,
                    sponsorWallet: fallbackSponsorWalletAddress,
                  };
                  await expect(
                    dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                  ).to.be.revertedWith('Root is zero'); */
                    });
                  });
                });
                context('Update params does not match', function () {
                  it('reverts', async function () {
                    const {
                      roles,
                      dapiFallbackV2,
                      dapiName,
                      fallbackBeaconId,
                      fallbackRoot,
                      fallbackProof,
                      priceRoot,
                      priceProof,
                      duration,
                      price,
                      fallbackSponsorWalletAddress,
                    } = await helpers.loadFixture(deploy);
                    const deviationThresholdInPercentage = hre.ethers.utils.parseUnits('25', 4); // 0.25%
                    const heartbeatInterval = 86400; // 1 day in seconds
                    const deviationReference = 0;

                    const unmatchedUpdateParams = hre.ethers.utils.defaultAbiCoder.encode(
                      ['uint256', 'int224', 'uint32'],
                      [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
                    );
                    const executeDapiFallbackArgs = {
                      dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                      dataFeedId: fallbackBeaconId,
                      fallbackRoot: fallbackRoot,
                      fallbackProof: fallbackProof,
                      updateParams: unmatchedUpdateParams,
                      priceRoot: priceRoot,
                      priceProof: priceProof,
                      duration: duration,
                      price: price,
                      sponsorWallet: fallbackSponsorWalletAddress,
                    };
                    await expect(
                      dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                    ).to.be.revertedWith('Update params does not match');
                  });
                });
              });
              context('Sponsor wallet address is zero', function () {
                it('reverts', async function () {
                  const {
                    roles,
                    dapiFallbackV2,
                    dapiName,
                    fallbackBeaconId,
                    fallbackRoot,
                    fallbackProof,
                    updateParams,
                    priceRoot,
                    priceProof,
                    duration,
                    price,
                  } = await helpers.loadFixture(deploy);
                  const zeroAddress = hre.ethers.constants.AddressZero;
                  const executeDapiFallbackArgs = {
                    dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                    dataFeedId: fallbackBeaconId,
                    fallbackRoot: fallbackRoot,
                    fallbackProof: fallbackProof,
                    updateParams: updateParams,
                    priceRoot: priceRoot,
                    priceProof: priceProof,
                    duration: duration,
                    price: price,
                    sponsorWallet: zeroAddress,
                  };
                  await expect(
                    dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                  ).to.be.revertedWith('Zero address');
                });
              });
            });
            context('Price is zero', function () {
              it('reverts', async function () {
                const {
                  roles,
                  dapiFallbackV2,
                  dapiName,
                  fallbackBeaconId,
                  fallbackRoot,
                  fallbackProof,
                  updateParams,
                  priceRoot,
                  priceProof,
                  duration,
                  fallbackSponsorWalletAddress,
                } = await helpers.loadFixture(deploy);
                const executeDapiFallbackArgs = {
                  dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                  dataFeedId: fallbackBeaconId,
                  fallbackRoot: fallbackRoot,
                  fallbackProof: fallbackProof,
                  updateParams: updateParams,
                  priceRoot: priceRoot,
                  priceProof: priceProof,
                  duration: duration,
                  price: 0,
                  sponsorWallet: fallbackSponsorWalletAddress,
                };
                await expect(
                  dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
                ).to.be.revertedWith('Price is zero');
              });
            });
          });
          context('Duration is zero', function () {
            it('reverts', async function () {
              const {
                roles,
                dapiFallbackV2,
                dapiName,
                fallbackBeaconId,
                fallbackRoot,
                fallbackProof,
                updateParams,
                priceRoot,
                priceProof,
                price,
                fallbackSponsorWalletAddress,
              } = await helpers.loadFixture(deploy);
              const executeDapiFallbackArgs = {
                dapiName: hre.ethers.utils.formatBytes32String(dapiName),
                dataFeedId: fallbackBeaconId,
                fallbackRoot: fallbackRoot,
                fallbackProof: fallbackProof,
                updateParams: updateParams,
                priceRoot: priceRoot,
                priceProof: priceProof,
                duration: 0,
                price: price,
                sponsorWallet: fallbackSponsorWalletAddress,
              };
              await expect(
                dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
              ).to.be.revertedWith('Duration is zero');
            });
          });
        });
        context('Update params are empty', function () {
          it('reverts', async function () {
            const {
              roles,
              dapiFallbackV2,
              dapiName,
              fallbackBeaconId,
              fallbackRoot,
              fallbackProof,
              priceRoot,
              priceProof,
              price,
              duration,
              fallbackSponsorWalletAddress,
            } = await helpers.loadFixture(deploy);
            const emptyUpdateParams = [];
            const executeDapiFallbackArgs = {
              dapiName: hre.ethers.utils.formatBytes32String(dapiName),
              dataFeedId: fallbackBeaconId,
              fallbackRoot: fallbackRoot,
              fallbackProof: fallbackProof,
              updateParams: emptyUpdateParams,
              priceRoot: priceRoot,
              priceProof: priceProof,
              duration: duration,
              price: price,
              sponsorWallet: fallbackSponsorWalletAddress,
            };
            await expect(
              dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
            ).to.be.revertedWith('Update params empty');
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const {
            roles,
            dapiFallbackV2,
            dapiName,
            fallbackRoot,
            fallbackProof,
            updateParams,
            priceRoot,
            priceProof,
            price,
            duration,
            fallbackSponsorWalletAddress,
          } = await helpers.loadFixture(deploy);
          const zeroDatafeedID = hre.ethers.constants.HashZero;
          const executeDapiFallbackArgs = {
            dapiName: hre.ethers.utils.formatBytes32String(dapiName),
            dataFeedId: zeroDatafeedID,
            fallbackRoot: fallbackRoot,
            fallbackProof: fallbackProof,
            updateParams: updateParams,
            priceRoot: priceRoot,
            priceProof: priceProof,
            duration: duration,
            price: price,
            sponsorWallet: fallbackSponsorWalletAddress,
          };
          await expect(
            dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
          ).to.be.revertedWith('Data feed ID is zero');
        });
      });
    });
    context('Dapi name is zero', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2, updateParams, priceRoot, priceProof, duration, price } =
          await helpers.loadFixture(deploy);
        const dapiName = '';
        const fallbackBeaconTemplateId = generateRandomBytes32();
        const fallbackBeaconId = hre.ethers.utils.solidityKeccak256(
          ['address', 'bytes32'],
          [roles.airnode1.address, fallbackBeaconTemplateId]
        );
        const fallbackSponsorWalletAddress = generateRandomAddress();
        const fallbackTreeEntry = [
          hre.ethers.utils.formatBytes32String(dapiName),
          fallbackBeaconId,
          fallbackSponsorWalletAddress,
        ];
        const fallbackTreeValues = [
          [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
          [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
          fallbackTreeEntry,
          [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
          [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
        ];
        const fallbackTree = StandardMerkleTree.of(fallbackTreeValues, ['bytes32', 'bytes32', 'address']);
        const fallbackRoot = fallbackTree.root;
        const fallbackProof = fallbackTree.getProof(fallbackTreeEntry);
        const executeDapiFallbackArgs = {
          dapiName: hre.ethers.utils.formatBytes32String(dapiName),
          dataFeedId: fallbackBeaconId,
          fallbackRoot: fallbackRoot,
          fallbackProof: fallbackProof,
          updateParams: updateParams,
          priceRoot: priceRoot,
          priceProof: priceProof,
          duration: duration,
          price: price,
          sponsorWallet: fallbackSponsorWalletAddress,
        };
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
        ).to.be.revertedWith('Dapi name is zero');
      });
    });
  });

  describe('revertDapiFallback', function () {
    it('executes dAPI fallback', async function () {
      const {
        roles,
        dapiFallbackV2,
        dapiName,
        executeDapiFallbackArgs,
        dapiDataRegistry,
        dataFeeds,
        dapiTree,
        dapiTreeValues,
      } = await helpers.loadFixture(deploy);
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
      const [, beaconSetId, sponsorWallet] = dapiTreeValue;
      await dapiDataRegistry
        .connect(roles.api3Market)
        .addDapi(
          hre.ethers.utils.formatBytes32String(dapiName),
          beaconSetId,
          sponsorWallet,
          deviationThresholdInPercentage,
          deviationReference,
          heartbeatInterval,
          dapiTree.root,
          dapiTree.getProof(dapiTreeValue)
        );
      await dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs);
      expect(await dapiFallbackV2.getFallbackedDapis()).to.deep.equal([hre.ethers.utils.formatBytes32String(dapiName)]);

      await expect(
        dapiFallbackV2
          .connect(roles.dapiFallbackV2Owner)
          .revertDapiFallback(
            hre.ethers.utils.formatBytes32String(dapiName),
            beaconSetId,
            sponsorWallet,
            deviationThresholdInPercentage,
            deviationReference,
            heartbeatInterval,
            dapiTree.root,
            dapiTree.getProof(dapiTreeValue)
          )
      )
        .to.emit(dapiFallbackV2, 'RevertedDapiFallback')
        .withArgs(hre.ethers.utils.formatBytes32String(dapiName), beaconSetId, sponsorWallet);
      expect(await dapiFallbackV2.getFallbackedDapis()).to.deep.equal([]);
    });
  });
});

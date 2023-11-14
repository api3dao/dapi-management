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
    const price = hre.ethers.utils.parseEther('10');
    const deviationThresholdInPercentage = hre.ethers.utils.parseUnits('1', 6); // 1e6 represents 1%
    const deviationReference = 0;
    const heartbeatInterval = 86400; // 1 day in seconds
    const updateParamsOne = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
    );
    const updateParamsTwo = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage * 2, deviationReference, heartbeatInterval]
    );
    const updateParamsFour = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'int224', 'uint32'],
      [deviationThresholdInPercentage * 4, deviationReference, heartbeatInterval]
    );
    const priceTreeValues = dapiNamesWithSponsorWallets
      .map(([dapiName]) => [
        [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParamsOne, duration, price],
        [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParamsTwo, duration * 1.5, price.div(2)],
        [hre.ethers.utils.formatBytes32String(dapiName), chainId, updateParamsFour, duration * 2, price.div(4)],
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
    context('HashRegistry address is not zero', function () {
      context('DapiDataRegistry address is not zero', function () {
        context('DapiFallbackV2 address is not zero', function () {
          context('ProxyFactory address is not zero', function () {
            context('Api3ServerV1 address is not zero', function () {
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
            context('Api3ServerV1 address is zero', function () {
              it('reverts', async function () {
                const { roles, hashRegistry, dapiDataRegistry, dapiFallbackV2, proxyFactory } =
                  await helpers.loadFixture(deploy);
                const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);

                await expect(
                  Api3Market.deploy(
                    hashRegistry.address,
                    dapiDataRegistry.address,
                    dapiFallbackV2.address,
                    proxyFactory.address,
                    hre.ethers.constants.AddressZero
                  )
                ).to.have.been.revertedWith('Api3ServerV1 address is zero');
              });
            });
          });
          context('ProxyFactory address is zero', function () {
            it('reverts', async function () {
              const { roles, hashRegistry, dapiDataRegistry, dapiFallbackV2, api3ServerV1 } = await helpers.loadFixture(
                deploy
              );
              const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);

              await expect(
                Api3Market.deploy(
                  hashRegistry.address,
                  dapiDataRegistry.address,
                  dapiFallbackV2.address,
                  hre.ethers.constants.AddressZero,
                  api3ServerV1.address
                )
              ).to.have.been.revertedWith('ProxyFactory address is zero');
            });
          });
        });
        context('DapiFallbackV2 address is zero', function () {
          it('reverts', async function () {
            const { roles, hashRegistry, dapiDataRegistry, proxyFactory, api3ServerV1 } = await helpers.loadFixture(
              deploy
            );
            const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);

            await expect(
              Api3Market.deploy(
                hashRegistry.address,
                dapiDataRegistry.address,
                hre.ethers.constants.AddressZero,
                proxyFactory.address,
                api3ServerV1.address
              )
            ).to.have.been.revertedWith('DapiFallbackV2 address is zero');
          });
        });
      });
      context('DapiDataRegistry address is zero', function () {
        it('reverts', async function () {
          const { roles, hashRegistry, dapiFallbackV2, proxyFactory, api3ServerV1 } = await helpers.loadFixture(deploy);
          const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);

          await expect(
            Api3Market.deploy(
              hashRegistry.address,
              hre.ethers.constants.AddressZero,
              dapiFallbackV2.address,
              proxyFactory.address,
              api3ServerV1.address
            )
          ).to.have.been.revertedWith('DapiDataRegistry address is zero');
        });
      });
    });
    context('HashRegistry address is zero', function () {
      it('reverts', async function () {
        const { roles, dapiDataRegistry, dapiFallbackV2, proxyFactory, api3ServerV1 } = await helpers.loadFixture(
          deploy
        );
        const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);

        await expect(
          Api3Market.deploy(
            hre.ethers.constants.AddressZero,
            dapiDataRegistry.address,
            dapiFallbackV2.address,
            proxyFactory.address,
            api3ServerV1.address
          )
        ).to.have.been.revertedWith('HashRegistry address is zero');
      });
    });
  });

  describe('buyDapi', function () {
    context('Dapi has not been fallbacked', function () {
      context('Beacons is not empty', function () {
        context('dAPI pricing Merkle tree root has been registered', function () {
          context('Valid dAPI pricing Merkle tree proof', function () {
            context('Signed API URL proofs length is correct', function () {
              context('Value is enough for payment', function () {
                it('buys first dAPI subscription', async function () {
                  const {
                    roles,
                    api3Market,
                    dapiDataRegistry,
                    proxyFactory,
                    api3ServerV1,
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

                  const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                  expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                  const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                    .timestamp;
                  await expect(api3Market.connect(roles.randomPerson).buyDapi(args, { value: price }))
                    .to.emit(api3Market, 'BoughtDapi')
                    .withArgs(
                      dapiName,
                      dataFeedId,
                      dapiProxyAddress,
                      price,
                      duration,
                      updateParams,
                      price, // sponsorWallet balance
                      roles.randomPerson.address
                    );

                  await Promise.all(
                    apiTreeValues.map(async ([airnode, url]) => {
                      expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                    })
                  );
                  const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                  expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                  const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                  const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                    await dapiDataRegistry.readDapiWithName(dapiName);
                  expect(updateParameters).to.deep.equal(
                    hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], updateParams)
                  );
                  expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                  expect(dataFeed).to.equal(encodedBeaconSetData);
                  expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                  expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                  await Promise.all(
                    beacons.map(async ({ airnode, templateId, data }) => {
                      const beaconId = hre.ethers.utils.solidityKeccak256(
                        ['address', 'bytes32'],
                        [airnode, templateId]
                      );
                      const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                      const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                      expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                    })
                  );
                  expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(price);

                  const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                  expect(current.price).to.equal(price);
                  expect(current.duration).to.equal(duration);
                  expect(current.start).to.be.approximately(now, 1);
                  expect(current.purchasedAt).to.be.approximately(now, 1);
                  expect(pending.price).to.equal(hre.ethers.constants.Zero);
                  expect(pending.duration).to.equal(hre.ethers.constants.Zero);
                  expect(pending.start).to.equal(hre.ethers.constants.Zero);
                  expect(pending.purchasedAt).to.equal(hre.ethers.constants.Zero);
                });
                context('Does not buy a subscription for the same dAPI on the same day', function () {
                  context('Extends or downgrades current purchase', function () {
                    context('There is not already a pending extension or downgrade', function () {
                      it('buys extension dAPI subscription', async function () {
                        const {
                          roles,
                          api3Market,
                          dapiDataRegistry,
                          proxyFactory,
                          api3ServerV1,
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

                        const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                        await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                        const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                          .timestamp;
                        const futureNow = now + duration / 2;
                        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

                        // Extend from the middle of current subscription
                        const expectedPrice = price.sub(price.mul(duration / 2).div(duration));
                        const expectedDuration = duration / 2;
                        await expect(api3Market.connect(roles.randomPerson).buyDapi(args, { value: price }))
                          .to.emit(api3Market, 'BoughtDapi')
                          .withArgs(
                            dapiName,
                            dataFeedId,
                            dapiProxyAddress,
                            expectedPrice,
                            expectedDuration,
                            updateParams,
                            price.add(expectedPrice), // sponsorWallet balance
                            roles.randomPerson.address
                          );

                        await Promise.all(
                          apiTreeValues.map(async ([airnode, url]) => {
                            expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                          })
                        );
                        const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                        expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                        const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                        const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                          await dapiDataRegistry.readDapiWithName(dapiName);
                        expect(updateParameters).to.deep.equal(
                          hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], updateParams)
                        );
                        expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                        expect(dataFeed).to.equal(encodedBeaconSetData);
                        expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                        await Promise.all(
                          beacons.map(async ({ airnode, templateId, data }) => {
                            const beaconId = hre.ethers.utils.solidityKeccak256(
                              ['address', 'bytes32'],
                              [airnode, templateId]
                            );
                            const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                            const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                            expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                          })
                        );
                        expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(price.add(expectedPrice));

                        const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                        expect(current.price).to.equal(price);
                        expect(current.duration).to.equal(duration);
                        expect(current.start).to.equal(now);
                        expect(current.purchasedAt).to.equal(now);
                        expect(pending.price).to.equal(expectedPrice);
                        expect(pending.duration).to.equal(expectedDuration);
                        expect(pending.start).to.equal(now + duration);
                        expect(pending.purchasedAt).to.equal(futureNow);
                      });
                      it('buys downgrade dAPI subscription', async function () {
                        const {
                          roles,
                          api3Market,
                          dapiDataRegistry,
                          proxyFactory,
                          api3ServerV1,
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

                        const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                        await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                        const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                          .timestamp;
                        const futureNow = now + duration / 2;
                        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

                        // Downgrade from the middle of current subscription
                        const [, , downgradeUpdateParams, downgradeDuration, downgradePrice] =
                          priceTreeValues[randomIndex * 3 + 1];
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

                        const expectedPrice = downgradePrice
                          .sub(downgradePrice.mul(duration / 2).div(downgradeDuration))
                          .sub(1);
                        const expectedDuration = downgradeDuration - duration / 2;
                        await expect(
                          api3Market
                            .connect(roles.randomPerson)
                            .buyDapi(
                              { ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof },
                              { value: downgradePrice }
                            )
                        )
                          .to.emit(api3Market, 'BoughtDapi')
                          .withArgs(
                            dapiName,
                            dataFeedId,
                            dapiProxyAddress,
                            expectedPrice,
                            expectedDuration,
                            downgradeUpdateParams,
                            price.add(expectedPrice), // sponsorWallet balance
                            roles.randomPerson.address
                          );

                        await Promise.all(
                          apiTreeValues.map(async ([airnode, url]) => {
                            expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                          })
                        );
                        const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                        expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                        const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                        const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                          await dapiDataRegistry.readDapiWithName(dapiName);
                        expect(updateParameters).to.deep.equal(
                          hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], updateParams)
                        );
                        expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                        expect(dataFeed).to.equal(encodedBeaconSetData);
                        expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                        await Promise.all(
                          beacons.map(async ({ airnode, templateId, data }) => {
                            const beaconId = hre.ethers.utils.solidityKeccak256(
                              ['address', 'bytes32'],
                              [airnode, templateId]
                            );
                            const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                            const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                            expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                          })
                        );
                        expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(price.add(expectedPrice));

                        const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                        expect(current.price).to.equal(price);
                        expect(current.duration).to.equal(duration);
                        expect(current.start).to.equal(now);
                        expect(current.purchasedAt).to.equal(now);
                        expect(pending.price).to.equal(expectedPrice);
                        expect(pending.duration).to.equal(expectedDuration);
                        expect(pending.start).to.equal(now + duration);
                        expect(pending.purchasedAt).to.equal(futureNow);
                      });
                    });
                    context('There is already a pending extension or downgrade', function () {
                      it('reverts', async function () {
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

                        const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                        await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                        const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                          .timestamp;

                        // Downgrade from the middle of current subscription
                        const [, , downgradeUpdateParams, downgradeDuration, downgradePrice] =
                          priceTreeValues[randomIndex * 3 + 1];
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

                        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [now + duration / 3]);
                        await api3Market
                          .connect(roles.randomPerson)
                          .buyDapi(
                            { ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof },
                            { value: downgradePrice }
                          );

                        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [now + duration / 2]);
                        await expect(
                          api3Market
                            .connect(roles.randomPerson)
                            .buyDapi(
                              { ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof },
                              { value: downgradePrice }
                            )
                        ).to.have.been.revertedWith('There is already a pending extension or downgrade');
                      });
                    });
                  });
                  context('Does not extends nor downgrades current purchase', function () {
                    it.skip('reverts', async function () {
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

                      const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                      expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                      await hre.network.provider.send('evm_setAutomine', [false]);
                      await hre.network.provider.send('evm_setIntervalMining', [0]);
                      await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                      const tx = await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });
                      await hre.network.provider.send('evm_mine');
                      expect(tx).to.have.been.revertedWith('Does not extends nor downgrades current purchase');
                    });
                  });
                  it('buys upgrade dAPI subscription', async function () {
                    const {
                      roles,
                      api3Market,
                      dapiDataRegistry,
                      proxyFactory,
                      api3ServerV1,
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

                    const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3 + 1];
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
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                    await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                    const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                      .timestamp;
                    const futureNow = now + duration / 2;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

                    // Upgrade from the middle of current subscription
                    const [, , upgradeUpdateParams, upgradeDuration, upgradePrice] = priceTreeValues[randomIndex * 3];
                    const upgradePriceTreeProof = priceTree.getProof([
                      dapiName,
                      chainId,
                      upgradeUpdateParams,
                      upgradeDuration,
                      upgradePrice,
                    ]);
                    const upgradeDapi = {
                      name: dapiName,
                      sponsorWallet,
                      price: upgradePrice,
                      duration: upgradeDuration,
                      updateParams: upgradeUpdateParams,
                    };

                    const expectedPrice = upgradePrice.sub(price.mul(duration / 2).div(duration));
                    await expect(
                      api3Market
                        .connect(roles.randomPerson)
                        .buyDapi(
                          { ...args, dapi: upgradeDapi, priceProof: upgradePriceTreeProof },
                          { value: upgradePrice }
                        )
                    )
                      .to.emit(api3Market, 'BoughtDapi')
                      .withArgs(
                        dapiName,
                        dataFeedId,
                        dapiProxyAddress,
                        expectedPrice,
                        upgradeDuration,
                        upgradeUpdateParams,
                        price.add(expectedPrice), // sponsorWallet balance
                        roles.randomPerson.address
                      );

                    await Promise.all(
                      apiTreeValues.map(async ([airnode, url]) => {
                        expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                      })
                    );
                    const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                    expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                    const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                    const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                      await dapiDataRegistry.readDapiWithName(dapiName);
                    expect(updateParameters).to.deep.equal(
                      hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], upgradeUpdateParams)
                    );
                    expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                    expect(dataFeed).to.equal(encodedBeaconSetData);
                    expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                    await Promise.all(
                      beacons.map(async ({ airnode, templateId, data }) => {
                        const beaconId = hre.ethers.utils.solidityKeccak256(
                          ['address', 'bytes32'],
                          [airnode, templateId]
                        );
                        const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                        const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                        expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                      })
                    );
                    expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(price.add(expectedPrice));

                    const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                    expect(current.price).to.equal(upgradePrice);
                    expect(current.duration).to.equal(upgradeDuration);
                    expect(current.start).to.equal(futureNow);
                    expect(current.purchasedAt).to.equal(futureNow);
                    expect(pending.price).to.equal(hre.ethers.constants.Zero);
                    expect(pending.duration).to.equal(hre.ethers.constants.Zero);
                    expect(pending.start).to.equal(hre.ethers.constants.Zero);
                    expect(pending.purchasedAt).to.equal(hre.ethers.constants.Zero);
                  });
                  it('buys upgrade that overrides pending downgrade dAPI subscription', async function () {
                    const {
                      roles,
                      api3Market,
                      dapiDataRegistry,
                      proxyFactory,
                      api3ServerV1,
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

                    const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3 + 1];
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
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                    await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                    const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                      .timestamp;
                    let futureNow = now + duration / 4;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

                    // Downgrade from the middle of current subscription
                    const [, , downgradeUpdateParams, downgradeDuration, downgradePrice] =
                      priceTreeValues[randomIndex * 3 + 2];
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

                    await api3Market
                      .connect(roles.randomPerson)
                      .buyDapi(
                        { ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof },
                        { value: downgradePrice }
                      );

                    futureNow = now + duration - 10;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [futureNow]);

                    // Upgrade from the middle of current subscription
                    const [, , upgradeUpdateParams, upgradeDuration, upgradePrice] = priceTreeValues[randomIndex * 3];
                    const upgradePriceTreeProof = priceTree.getProof([
                      dapiName,
                      chainId,
                      upgradeUpdateParams,
                      upgradeDuration,
                      upgradePrice,
                    ]);
                    const upgradeDapi = {
                      name: dapiName,
                      sponsorWallet,
                      price: upgradePrice,
                      duration: upgradeDuration,
                      updateParams: upgradeUpdateParams,
                    };

                    const expectedDowngradePrice = downgradePrice
                      .mul(downgradeDuration - (duration / 4) * 3)
                      .div(downgradeDuration);
                    const expectedPrice = upgradePrice.sub(price.mul(10).div(duration)).sub(expectedDowngradePrice);
                    await expect(
                      api3Market
                        .connect(roles.randomPerson)
                        .buyDapi(
                          { ...args, dapi: upgradeDapi, priceProof: upgradePriceTreeProof },
                          { value: upgradePrice }
                        )
                    )
                      .to.emit(api3Market, 'BoughtDapi')
                      .withArgs(
                        dapiName,
                        dataFeedId,
                        dapiProxyAddress,
                        expectedPrice,
                        upgradeDuration,
                        upgradeUpdateParams,
                        price.add(expectedDowngradePrice).add(expectedPrice), // sponsorWallet balance
                        roles.randomPerson.address
                      );

                    await Promise.all(
                      apiTreeValues.map(async ([airnode, url]) => {
                        expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                      })
                    );
                    const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                    expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                    const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                    const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                      await dapiDataRegistry.readDapiWithName(dapiName);
                    expect(updateParameters).to.deep.equal(
                      hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], upgradeUpdateParams)
                    );
                    expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                    expect(dataFeed).to.equal(encodedBeaconSetData);
                    expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                    await Promise.all(
                      beacons.map(async ({ airnode, templateId, data }) => {
                        const beaconId = hre.ethers.utils.solidityKeccak256(
                          ['address', 'bytes32'],
                          [airnode, templateId]
                        );
                        const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                        const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                        expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                      })
                    );
                    expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(
                      price.add(expectedDowngradePrice).add(expectedPrice)
                    );

                    const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                    expect(current.price).to.equal(upgradePrice);
                    expect(current.duration).to.equal(upgradeDuration);
                    expect(current.start).to.equal(futureNow);
                    expect(current.purchasedAt).to.equal(futureNow);
                    expect(pending.price).to.equal(hre.ethers.constants.Zero);
                    expect(pending.duration).to.equal(hre.ethers.constants.Zero);
                    expect(pending.start).to.equal(hre.ethers.constants.Zero);
                    expect(pending.purchasedAt).to.equal(hre.ethers.constants.Zero);
                  });
                  it('buys upgrade with pending downgrade dAPI subscription', async function () {
                    const {
                      roles,
                      api3Market,
                      dapiDataRegistry,
                      proxyFactory,
                      api3ServerV1,
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

                    const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3 + 1];
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
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                    await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                    const now = (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))
                      .timestamp;
                    const downgradePurchasedAt = now + duration / 3;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [downgradePurchasedAt]);

                    // Downgrade from the middle of current subscription
                    const [, , downgradeUpdateParams, downgradeDuration, downgradePrice] =
                      priceTreeValues[randomIndex * 3 + 2];
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

                    await api3Market
                      .connect(roles.randomPerson)
                      .buyDapi(
                        { ...args, dapi: downgradeDapi, priceProof: downgradePriceTreeProof },
                        { value: downgradePrice }
                      );

                    const upgradePurchasedAt = now + duration / 2;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [upgradePurchasedAt]);

                    // Upgrade from the middle of current subscription
                    const [, , upgradeUpdateParams, upgradeDuration, upgradePrice] = priceTreeValues[randomIndex * 3];
                    const upgradePriceTreeProof = priceTree.getProof([
                      dapiName,
                      chainId,
                      upgradeUpdateParams,
                      upgradeDuration,
                      upgradePrice,
                    ]);
                    const upgradeDapi = {
                      name: dapiName,
                      sponsorWallet,
                      price: upgradePrice,
                      duration: upgradeDuration,
                      updateParams: upgradeUpdateParams,
                    };

                    const expectedDowngradeDuration = downgradeDuration / 2;
                    const expectedDowngradePrice = downgradePrice.sub(
                      downgradePrice.mul((duration / 3) * 2).div(downgradeDuration)
                    );
                    const overlapUpgradeDowngradeDuration = upgradeDuration - duration / 2;
                    const overlapUpgradeDowngradePrice = downgradePrice
                      .mul(overlapUpgradeDowngradeDuration)
                      .div(downgradeDuration);
                    const expectedPrice = upgradePrice
                      .sub(price.mul(duration / 2).div(duration))
                      .sub(overlapUpgradeDowngradePrice);
                    await expect(
                      api3Market
                        .connect(roles.randomPerson)
                        .buyDapi(
                          { ...args, dapi: upgradeDapi, priceProof: upgradePriceTreeProof },
                          { value: upgradePrice }
                        )
                    )
                      .to.emit(api3Market, 'BoughtDapi')
                      .withArgs(
                        dapiName,
                        dataFeedId,
                        dapiProxyAddress,
                        expectedPrice,
                        upgradeDuration,
                        upgradeUpdateParams,
                        price.add(expectedDowngradePrice).add(expectedPrice), // sponsorWallet balance
                        roles.randomPerson.address
                      );

                    await Promise.all(
                      apiTreeValues.map(async ([airnode, url]) => {
                        expect(await dapiDataRegistry.airnodeToSignedApiUrl(airnode)).to.equal(url);
                      })
                    );
                    const { airnodes, templateIds } = dataFeeds[randomIndex].reduce(
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
                    expect(await dapiDataRegistry.dataFeeds(dataFeedId)).to.equal(encodedBeaconSetData);
                    const [onChainBeaconSetValue] = await api3ServerV1.dataFeeds(dataFeedId);
                    const { updateParameters, dataFeedValue, dataFeed, signedApiUrls } =
                      await dapiDataRegistry.readDapiWithName(dapiName);
                    expect(updateParameters).to.deep.equal(
                      hre.ethers.utils.defaultAbiCoder.decode(['uint256', 'int224', 'uint32'], upgradeUpdateParams)
                    );
                    expect(dataFeedValue[0]).to.equal(onChainBeaconSetValue);
                    expect(dataFeed).to.equal(encodedBeaconSetData);
                    expect(signedApiUrls).to.deep.equal(apiTreeValues.map(([, url]) => url));
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).not.to.equal('0x');
                    await Promise.all(
                      beacons.map(async ({ airnode, templateId, data }) => {
                        const beaconId = hre.ethers.utils.solidityKeccak256(
                          ['address', 'bytes32'],
                          [airnode, templateId]
                        );
                        const decodedData = hre.ethers.utils.defaultAbiCoder.decode(['int256'], data)[0];
                        const [onChainBeaconValue] = await api3ServerV1.dataFeeds(beaconId);
                        expect(onChainBeaconValue.toString()).to.equal(decodedData.toString());
                      })
                    );
                    expect(await hre.ethers.provider.getBalance(sponsorWallet)).to.equal(
                      price.add(expectedDowngradePrice).add(expectedPrice)
                    );

                    const [current, pending] = await api3Market.readCurrentAndPendingPurchases(dapiName);
                    expect(current.price).to.equal(upgradePrice);
                    expect(current.duration).to.equal(upgradeDuration);
                    expect(current.start).to.equal(upgradePurchasedAt);
                    expect(current.purchasedAt).to.equal(upgradePurchasedAt);
                    expect(pending.price).to.equal(expectedDowngradePrice.sub(overlapUpgradeDowngradePrice));
                    expect(pending.duration).to.equal(expectedDowngradeDuration - overlapUpgradeDowngradeDuration);
                    expect(pending.start).to.equal(upgradePurchasedAt + upgradeDuration);
                    expect(pending.purchasedAt).to.equal(downgradePurchasedAt);
                  });
                });
                context('Buys a subscription for the same dAPI on the same day', function () {
                  it('reverts', async function () {
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

                    const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                    expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                    await api3Market.connect(roles.randomPerson).buyDapi(args, { value: price });

                    await expect(
                      api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })
                    ).to.have.been.revertedWith('dAPI has been purchased on the last day');
                  });
                });
              });
              context('Value is not enough for payment', function () {
                it('reverts', async function () {
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

                  const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                  expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

                  await expect(
                    api3Market.connect(roles.randomPerson).buyDapi(args, { value: price.sub(1) })
                  ).to.have.been.revertedWith('Insufficient payment');
                });
              });
            });
            context('Signed API URL proofs length is incorrect', function () {
              it('reverts', async function () {
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

                const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
                expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

                const [, ...rest] = beacons;

                const args = {
                  dapi,
                  beacons: rest,
                  signedApiUrlRoot: apiTreeRoot,
                  signedApiUrlProofs: apiTreeProofs,
                  dapiRoot: dapiTreeRoot,
                  dapiProof: dapiTreeProof,
                  priceRoot: priceTreeRoot,
                  priceProof: priceTreeProof,
                };

                await expect(
                  api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })
                ).to.have.been.revertedWith('Signed API URL proofs length is incorrect');
              });
            });
          });
          context('Invalid dAPI pricing Merkle tree proof', function () {
            it('reverts', async function () {
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

              const [, , updateParams, duration, price] = priceTreeValues[randomIndex * 3];
              const priceTreeRoot = priceTree.root;

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
              expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

              const args = {
                dapi,
                beacons,
                signedApiUrlRoot: apiTreeRoot,
                signedApiUrlProofs: apiTreeProofs,
                dapiRoot: dapiTreeRoot,
                dapiProof: dapiTreeProof,
                priceRoot: priceTreeRoot,
                priceProof: [],
              };

              await expect(
                api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })
              ).to.have.been.revertedWith('Invalid proof');
            });
          });
        });
        context('dAPI pricing Merkle tree root has not been registered', function () {
          it('reverts', async function () {
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

            const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
            expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

            const args = {
              dapi,
              beacons,
              signedApiUrlRoot: apiTreeRoot,
              signedApiUrlProofs: apiTreeProofs,
              dapiRoot: dapiTreeRoot,
              dapiProof: dapiTreeProof,
              priceRoot: generateRandomBytes32(),
              priceProof: priceTreeProof,
            };

            await expect(
              api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })
            ).to.have.been.revertedWith('Root has not been registered');
          });
        });
      });
      context('Beacons is empty', function () {
        it('reverts', async function () {
          const {
            roles,
            api3Market,
            proxyFactory,
            apiTreeValues,
            apiTree,
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

          const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
          const priceTreeRoot = priceTree.root;
          const priceTreeProof = priceTree.getProof([dapiName, chainId, updateParams, duration, price]);

          const dapi = {
            name: dapiName,
            sponsorWallet,
            price,
            duration,
            updateParams,
          };

          const beacons = [];

          const dapiProxyAddress = await proxyFactory.computeDapiProxyAddress(dapiName, '0x');
          expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

          await expect(
            api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })
          ).to.have.been.revertedWith('Beacons is empty');
        });
      });
    });
    context('Dapi is fallbacked', function () {
      it('reverts', async function () {
        const {
          roles,
          hashRegistry,
          dapiDataRegistry,
          proxyFactory,
          api3ServerV1,
          apiTreeValues,
          apiTree,
          dataFeeds,
          dapiTreeValues,
          dapiTree,
          priceTreeValues,
          priceTree,
        } = await helpers.loadFixture(deploy);
        const DapiFallbackV2 = await hre.ethers.getContractFactory('MockDapiFallbackV2', roles.deployer);
        const dapiFallbackV2 = await DapiFallbackV2.deploy();

        const Api3Market = await hre.ethers.getContractFactory('Api3Market', roles.deployer);
        const api3Market = await Api3Market.deploy(
          hashRegistry.address,
          dapiDataRegistry.address,
          dapiFallbackV2.address,
          proxyFactory.address,
          api3ServerV1.address
        );

        const apiTreeRoot = apiTree.root;
        const apiTreeProofs = apiTreeValues.map(([airnode, url]) => apiTree.getProof([airnode, url]));

        const randomIndex = Math.floor(Math.random() * dapiTreeValues.length);
        const [dapiName, dataFeedId, sponsorWallet] = dapiTreeValues[randomIndex];
        const dapiTreeRoot = dapiTree.root;
        const dapiTreeProof = dapiTree.getProof([dapiName, dataFeedId, sponsorWallet]);

        const [, chainId, updateParams, duration, price] = priceTreeValues[randomIndex * 3];
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
        expect(await hre.ethers.provider.getCode(dapiProxyAddress)).to.equal('0x');

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

        await expect(api3Market.connect(roles.randomPerson).buyDapi(args, { value: price })).to.have.been.revertedWith(
          'Dapi is fallbacked'
        );
      });
    });
  });
});

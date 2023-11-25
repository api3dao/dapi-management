const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const {
  generateRandomBytes32,
  generateRandomAddress,
  deriveRole,
  deriveRootRole,
  generateRandomBytes,
} = require('./test-utils');

describe('DapiFallbackV2', function () {
  const HUNDRED_PERCENT = 1e8;

  function getRandomDapiFallbackAdmin(roles) {
    const dapiFallbackAdminId = Math.floor(Math.random() * 3);
    const dapiFallbackAdmin = roles[`dapiFallbackAdmin${dapiFallbackAdminId + 1}`];
    return { dapiFallbackAdminId, dapiFallbackAdmin };
  }

  async function updateBeacon(airnode, api3ServerV1, templateId, timestamp) {
    const data = hre.ethers.utils.defaultAbiCoder.encode(['int256'], [123]);
    await api3ServerV1.updateBeaconWithSignedData(
      airnode.address,
      templateId,
      timestamp,
      data,
      await airnode.signMessage(
        hre.ethers.utils.arrayify(
          hre.ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
        )
      )
    );
  }

  async function updateBeaconSet(airnodes, api3ServerV1, templateIds, timestamp) {
    let beaconIds = [];
    for (let ind = 0; ind < airnodes.length; ind++) {
      await updateBeacon(airnodes[ind], api3ServerV1, templateIds[ind], timestamp);
      beaconIds.push(
        hre.ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodes[ind].address, templateIds[ind]])
      );
    }
    await api3ServerV1.updateBeaconSetWithBeacons(beaconIds);
  }

  const deploy = async () => {
    const roleNames = [
      'deployer',
      'owner',
      'manager',
      'dapiFallbackAdmin1',
      'dapiFallbackAdmin2',
      'dapiFallbackAdmin3',
      'hashRegistryOwner',
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
    const hashRegistry = await HashRegistry.deploy(roles.hashRegistryOwner.address);

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
    await dapiFallbackV2.setUpDapiFallbackAdmins([
      roles.dapiFallbackAdmin1.address,
      roles.dapiFallbackAdmin2.address,
      roles.dapiFallbackAdmin3.address,
    ]);

    await dapiFallbackV2.connect(roles.deployer).transferOwnership(roles.owner.address);

    const rootRole = deriveRootRole(roles.manager.address);
    const api3ServerV1AdminRole = deriveRole(rootRole, api3ServerV1AdminRoleDescription);
    const dapiDataRegistryAdminRole = deriveRole(rootRole, dapiDataRegistryAdminRoleDescription);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(api3ServerV1AdminRole, await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION());
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiFallbackV2.address);

    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, dapiDataRegistryAdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(dapiDataRegistryAdminRole, await dapiDataRegistry.DAPI_ADDER_ROLE_DESCRIPTION());
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        dapiDataRegistryAdminRole,
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
    const fallbackBeaconTemplateId2 = generateRandomBytes32();
    const fallbackBeaconId2 = hre.ethers.utils.solidityKeccak256(
      ['address', 'bytes32'],
      [roles.airnode2.address, fallbackBeaconTemplateId2]
    );
    const fallbackSponsorWalletAddress2 = generateRandomAddress();

    const fallbackTreeEntry2 = [
      hre.ethers.utils.formatBytes32String(dapiName),
      fallbackBeaconId2,
      fallbackSponsorWalletAddress2,
    ];
    const fallbackTreeValues = [
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      fallbackTreeEntry,
      fallbackTreeEntry2,
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
    ];
    const fallbackTree = StandardMerkleTree.of(fallbackTreeValues, ['bytes32', 'bytes32', 'address']);
    const fallbackRoot = fallbackTree.root;
    const fallbackProof = fallbackTree.getProof(fallbackTreeEntry);
    const fallbackProof2 = fallbackTree.getProof(fallbackTreeEntry2);

    const dapiFallbackHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI fallback Merkle tree root']);
    const dapiFallbackRootSigners = [
      roles.dapiFallbackRootSigner1,
      roles.dapiFallbackRootSigner2,
      roles.dapiFallbackRootSigner3,
    ];
    const fallbackMessages = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes32', 'uint256'],
        [dapiFallbackHashType, fallbackRoot, timestamp]
      )
    );
    const fallbackSignatures = await Promise.all(
      dapiFallbackRootSigners.map(async (rootSigner) => await rootSigner.signMessage(fallbackMessages))
    );

    await hashRegistry.connect(roles.hashRegistryOwner).setUpSigners(
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
      ['uint256', 'int224', 'uint256'],
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
    const priceRootSigners = [roles.priceRootSigner1, roles.priceRootSigner2, roles.priceRootSigner3];
    const priceMessages = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [priceHashType, priceRoot, timestamp])
    );
    const priceSignatures = await Promise.all(
      priceRootSigners.map(async (rootSigner) => await rootSigner.signMessage(priceMessages))
    );
    await hashRegistry.connect(roles.hashRegistryOwner).setUpSigners(
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
    const dapiMessages = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [dapiHashType, dapiTreeRoot, timestamp])
    );
    const dapiTreeRootSignatures = await Promise.all(
      dapiFallbackRootSigners.map(async (rootSigner) => await rootSigner.signMessage(dapiMessages))
    );

    await hashRegistry.connect(roles.hashRegistryOwner).setUpSigners(
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
      fallbackBeaconTemplateId2,
      fallbackBeaconId2,
      fallbackSponsorWalletAddress2,
      fallbackRoot,
      fallbackProof,
      fallbackProof2,
      fallbackSignatures,
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
    context('Api3ServerV1 address is not zero', function () {
      context('HashRegistry address is not zero', function () {
        context('DapiDataRegistry address is not zero', function () {
          it('constructs', async function () {
            const { roles, api3ServerV1, hashRegistry, dapiDataRegistry, dapiFallbackV2 } = await helpers.loadFixture(
              deploy
            );
            const expectedDapiFallbackAdmins = [
              roles.dapiFallbackAdmin1.address,
              roles.dapiFallbackAdmin2.address,
              roles.dapiFallbackAdmin3.address,
            ];
            expect(await dapiFallbackV2.api3ServerV1()).to.equal(api3ServerV1.address);
            expect(await dapiFallbackV2.hashRegistry()).to.equal(hashRegistry.address);
            expect(await dapiFallbackV2.dapiDataRegistry()).to.equal(dapiDataRegistry.address);
            expect(await dapiFallbackV2.getDapiFallbackAdmins()).to.deep.equal(expectedDapiFallbackAdmins);
            const dapiFallbackAdmins = await dapiFallbackV2.getDapiFallbackAdmins();
            expect(dapiFallbackAdmins[0]).to.equal(roles.dapiFallbackAdmin1.address);
            expect(dapiFallbackAdmins[1]).to.equal(roles.dapiFallbackAdmin2.address);
            expect(dapiFallbackAdmins[2]).to.equal(roles.dapiFallbackAdmin3.address);
          });
        });
        context('DapiDataRegistry address zero', function () {
          it('reverts', async function () {
            const { roles, api3ServerV1, hashRegistry } = await helpers.loadFixture(deploy);
            const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
            await expect(
              DapiFallbackV2.deploy(api3ServerV1.address, hashRegistry.address, hre.ethers.constants.AddressZero)
            ).to.have.been.revertedWith('DapiDataRegistry address zero');
          });
        });
      });
      context('HashRegistry address zero', function () {
        it('reverts', async function () {
          const { roles, api3ServerV1, dapiDataRegistry } = await helpers.loadFixture(deploy);
          const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
          await expect(
            DapiFallbackV2.deploy(api3ServerV1.address, hre.ethers.constants.AddressZero, dapiDataRegistry.address)
          ).to.have.been.revertedWith('HashRegistry address zero');
        });
      });
    });
    context('Api3ServerV1 address zero', function () {
      it('reverts', async function () {
        const { roles, hashRegistry, dapiDataRegistry } = await helpers.loadFixture(deploy);
        const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
        await expect(
          DapiFallbackV2.deploy(hre.ethers.constants.AddressZero, hashRegistry.address, dapiDataRegistry.address)
        ).to.have.been.revertedWith('Api3ServerV1 address zero');
      });
    });
  });

  describe('receive', function () {
    it('receives', async function () {
      const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
      const amount = hre.ethers.utils.parseEther('1');
      const initialBalance = await hre.ethers.provider.getBalance(dapiFallbackV2.address);
      await expect(roles.randomPerson.sendTransaction({ to: dapiFallbackV2.address, value: amount })).to.not.have
        .reverted;
      expect(await hre.ethers.provider.getBalance(dapiFallbackV2.address)).to.equal(initialBalance.add(amount));
    });
  });

  describe('addDapiFallbackAdmin', function () {
    context('Sender is the owner', function () {
      context('dAPI fallback admin is not zero', function () {
        context('Admin does not exist', function () {
          it('adds a dAPI fallback admin', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            const dapiFallbackAdmin = generateRandomAddress();
            await expect(dapiFallbackV2.connect(roles.owner).addDapiFallbackAdmin(dapiFallbackAdmin))
              .to.emit(dapiFallbackV2, 'AddedDapiFallbackAdmin')
              .withArgs(dapiFallbackAdmin);
            expect(await dapiFallbackV2.getDapiFallbackAdmins()).to.deep.equal([
              roles.dapiFallbackAdmin1.address,
              roles.dapiFallbackAdmin2.address,
              roles.dapiFallbackAdmin3.address,
              dapiFallbackAdmin,
            ]);
          });
        });
        context('dAPI fallback admin exists', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            await expect(
              dapiFallbackV2.connect(roles.owner).addDapiFallbackAdmin(roles.dapiFallbackAdmin1.address)
            ).to.have.been.revertedWith('Duplicate admin address');
          });
        });
      });
      context('dAPI fallback admins is zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
          await expect(
            dapiFallbackV2.connect(roles.owner).addDapiFallbackAdmin(hre.ethers.constants.AddressZero)
          ).to.have.been.revertedWith('Admin address zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).addDapiFallbackAdmin(generateRandomAddress())
        ).to.have.been.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('removeDapiFallbackAdmin', function () {
    context('Sender is the owner', function () {
      context('dAPI fallback admin is not zero', function () {
        context('dAPI fallback admin exists', function () {
          it('removes the dAPI fallback admin', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            await expect(dapiFallbackV2.connect(roles.owner).removeDapiFallbackAdmin(roles.dapiFallbackAdmin2.address))
              .to.emit(dapiFallbackV2, 'RemovedDapiFallbackAdmin')
              .withArgs(roles.dapiFallbackAdmin2.address);
            expect(await dapiFallbackV2.getDapiFallbackAdmins()).to.deep.equal([
              roles.dapiFallbackAdmin1.address,
              roles.dapiFallbackAdmin3.address,
            ]);
          });
        });
        context('Admin does not exist', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            await expect(
              dapiFallbackV2.connect(roles.owner).removeDapiFallbackAdmin(generateRandomAddress())
            ).to.have.been.revertedWith('Admin does not exist');
          });
        });
      });
      context('dAPI fallback admins is zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
          await expect(
            dapiFallbackV2.connect(roles.owner).removeDapiFallbackAdmin(hre.ethers.constants.AddressZero)
          ).to.have.been.revertedWith('Admin address zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).removeDapiFallbackAdmin(generateRandomAddress())
        ).to.have.been.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('withdraw', function () {
    context('Sender is the owner', function () {
      context('Recipient address is not zero', function () {
        context('Amount is not zero', function () {
          context('Contract have enough funds', function () {
            it('withdraws the requested amount', async function () {
              const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              const amount = hre.ethers.utils.parseEther('1');
              const initialDapiFallbackV2Balance = await hre.ethers.provider.getBalance(dapiFallbackV2.address);
              const recipientAddress = roles.randomPerson.address;
              const initialRecipientBalance = await hre.ethers.provider.getBalance(recipientAddress);
              await expect(dapiFallbackV2.connect(roles.owner).withdraw(recipientAddress, amount))
                .to.emit(dapiFallbackV2, 'Withdrawn')
                .withArgs(recipientAddress, amount, initialDapiFallbackV2Balance.sub(amount));
              expect(await hre.ethers.provider.getBalance(dapiFallbackV2.address)).to.equal(
                initialDapiFallbackV2Balance.sub(amount)
              );
              expect(await hre.ethers.provider.getBalance(recipientAddress)).to.equal(
                initialRecipientBalance.add(amount)
              );
            });
          });
          context('Contract does not have enough funds', function () {
            it('reverts', async function () {
              const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              const balance = await hre.ethers.provider.getBalance(dapiFallbackV2.address);
              const amount = balance.add(1);
              const recipientAddress = roles.randomPerson.address;
              await expect(
                dapiFallbackV2.connect(roles.owner).withdraw(recipientAddress, amount)
              ).to.have.been.revertedWith('Address: insufficient balance');
            });
          });
        });
        context('Amount zero', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            const recipientAddress = roles.randomPerson.address;
            await expect(
              dapiFallbackV2.connect(roles.owner).withdraw(recipientAddress, hre.ethers.constants.Zero)
            ).to.have.been.revertedWith('Amount zero');
          });
        });
      });
      context('Recipient address is zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
          const amount = hre.ethers.utils.parseEther('1');
          await roles.randomPerson.sendTransaction({ to: dapiFallbackV2.address, value: amount.mul(2) });
          await expect(
            dapiFallbackV2.connect(roles.owner).withdraw(hre.ethers.constants.AddressZero, amount)
          ).to.have.been.revertedWith('Recipient address is zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        const amount = hre.ethers.utils.parseEther('1');
        await roles.randomPerson.sendTransaction({ to: dapiFallbackV2.address, value: amount.mul(2) });
        const recipientAddress = roles.randomPerson.address;
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).withdraw(recipientAddress, amount)
        ).to.have.been.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('withdrawAll', function () {
    context('Sender is the owner', function () {
      context('Recipient address is not zero', function () {
        context('DapiFallbackV2 balance is not zero', function () {
          context('Transfer is successful', function () {
            it('withdraws', async function () {
              const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              const initialBalance = await hre.ethers.provider.getBalance(dapiFallbackV2.address);
              const recipientAddress = roles.randomPerson.address;
              const initialRecipientBalance = await hre.ethers.provider.getBalance(recipientAddress);
              await expect(dapiFallbackV2.connect(roles.owner).withdrawAll(recipientAddress))
                .to.emit(dapiFallbackV2, 'Withdrawn')
                .withArgs(recipientAddress, initialBalance, 0);
              expect(await hre.ethers.provider.getBalance(dapiFallbackV2.address)).to.equal(0);
              expect(await hre.ethers.provider.getBalance(recipientAddress)).to.equal(
                initialRecipientBalance.add(initialBalance)
              );
            });
          });
          context('Transfer is not successful', function () {
            it('reverts', async function () {
              const { roles, api3ServerV1, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              const recipientAddress = api3ServerV1.address;
              await expect(dapiFallbackV2.connect(roles.owner).withdrawAll(recipientAddress)).to.have.been.revertedWith(
                'Address: unable to send value, recipient may have reverted'
              );
            });
          });
        });
        context('DapiFallbackV2 balance is not zero', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            const recipientAddress = roles.randomPerson.address;
            await dapiFallbackV2.connect(roles.owner).withdrawAll(roles.deployer.address);
            await expect(dapiFallbackV2.connect(roles.owner).withdrawAll(recipientAddress)).to.have.been.revertedWith(
              'Amount zero'
            );
          });
        });
      });
      context('Recipient address is zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
          await expect(
            dapiFallbackV2.connect(roles.owner).withdrawAll(hre.ethers.constants.AddressZero)
          ).to.have.been.revertedWith('Recipient address is zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        const recipientAddress = roles.randomPerson.address;
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).withdrawAll(recipientAddress)
        ).to.have.been.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('executeDapiFallback', function () {
    context('Sender is the dAPI fallback admin with the ID', function () {
      context('Dapi name is not zero', function () {
        context('Data feed ID is not zero', function () {
          context('Duration is not zero', function () {
            context('Price is not zero', function () {
              context('Sponsor wallet address is not zero', function () {
                context('Update params does match', function () {
                  context('Data feed ID will be changed', function () {
                    context('Tree has been registered', function () {
                      context('Valid tree proof', function () {
                        context('Data feed has been initialized', function () {
                          context('Data feed has been updated in the last day', function () {
                            context('dAPI fallback has not been already executed', function () {
                              context('Transfer is successful', function () {
                                it('executes dAPI fallback', async function () {
                                  const {
                                    roles,
                                    api3ServerV1,
                                    dapiFallbackV2,
                                    dapiName,
                                    fallbackBeaconId,
                                    fallbackBeaconTemplateId,
                                    fallbackSponsorWalletAddress,
                                    executeDapiFallbackArgs,
                                    dapiDataRegistry,
                                    dataFeeds,
                                    dapiTree,
                                    dapiTreeValues,
                                  } = await helpers.loadFixture(deploy);
                                  const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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
                                  await dapiDataRegistry
                                    .connect(roles.randomPerson)
                                    .registerDataFeed(encodedBeaconSetData);

                                  const deviationThresholdInPercentage = hre.ethers.BigNumber.from(
                                    HUNDRED_PERCENT / 50
                                  ); // 2%
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

                                  await updateBeacon(
                                    roles.airnode1,
                                    api3ServerV1,
                                    fallbackBeaconTemplateId,
                                    await helpers.time.latest()
                                  );

                                  await expect(
                                    dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                      ...executeDapiFallbackArgs,
                                      dapiFallbackAdminInd: dapiFallbackAdminId,
                                    })
                                  )
                                    .to.emit(dapiFallbackV2, 'ExecutedDapiFallback')
                                    .withArgs(
                                      hre.ethers.utils.formatBytes32String(dapiName),
                                      fallbackBeaconId,
                                      dapiFallbackAdmin.address
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
                              context('Transfer is not successful', function () {
                                it('reverts', async function () {
                                  const {
                                    roles,
                                    api3ServerV1,
                                    dapiFallbackV2,
                                    dapiName,
                                    fallbackBeaconTemplateId,
                                    executeDapiFallbackArgs,
                                    dapiDataRegistry,
                                    dataFeeds,
                                    dapiTree,
                                    dapiTreeValues,
                                  } = await helpers.loadFixture(deploy);
                                  const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);

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
                                  await dapiDataRegistry
                                    .connect(roles.randomPerson)
                                    .registerDataFeed(encodedBeaconSetData);

                                  const deviationThresholdInPercentage = hre.ethers.BigNumber.from(
                                    HUNDRED_PERCENT / 50
                                  ); // 2%
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

                                  await updateBeacon(
                                    roles.airnode1,
                                    api3ServerV1,
                                    fallbackBeaconTemplateId,
                                    await helpers.time.latest()
                                  );

                                  await dapiFallbackV2.connect(roles.owner).withdrawAll(roles.deployer.address);

                                  await expect(
                                    dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                      ...executeDapiFallbackArgs,
                                      dapiFallbackAdminInd: dapiFallbackAdminId,
                                    })
                                  ).to.have.been.revertedWith('Address: insufficient balance');
                                });
                              });
                            });
                            context('Fallback already executed', function () {
                              it('reverts', async function () {
                                const {
                                  roles,
                                  api3ServerV1,
                                  dapiFallbackV2,
                                  dapiName,
                                  fallbackBeaconId2,
                                  fallbackSponsorWalletAddress2,
                                  fallbackBeaconTemplateId,
                                  fallbackBeaconTemplateId2,
                                  fallbackProof2,
                                  executeDapiFallbackArgs,
                                  dapiDataRegistry,
                                  dataFeeds,
                                  dapiTree,
                                  dapiTreeValues,
                                } = await helpers.loadFixture(deploy);
                                const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);

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
                                await dapiDataRegistry
                                  .connect(roles.randomPerson)
                                  .registerDataFeed(encodedBeaconSetData);

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

                                await updateBeacon(
                                  roles.airnode1,
                                  api3ServerV1,
                                  fallbackBeaconTemplateId,
                                  await helpers.time.latest()
                                );
                                await updateBeacon(
                                  roles.airnode2,
                                  api3ServerV1,
                                  fallbackBeaconTemplateId2,
                                  await helpers.time.latest()
                                );

                                await dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                  ...executeDapiFallbackArgs,
                                  dapiFallbackAdminInd: dapiFallbackAdminId,
                                });

                                await expect(
                                  dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                    ...executeDapiFallbackArgs,
                                    dapiFallbackAdminInd: dapiFallbackAdminId,
                                    dataFeedId: fallbackBeaconId2,
                                    sponsorWallet: fallbackSponsorWalletAddress2,
                                    fallbackProof: fallbackProof2,
                                  })
                                ).to.have.been.revertedWith('Fallback already executed');
                              });
                            });
                          });
                          context('Data feed has not been updated in the last day', function () {
                            it('reverts', async function () {
                              const {
                                roles,
                                api3ServerV1,
                                dapiFallbackV2,
                                executeDapiFallbackArgs,
                                fallbackBeaconTemplateId,
                              } = await helpers.loadFixture(deploy);
                              await updateBeacon(
                                roles.airnode1,
                                api3ServerV1,
                                fallbackBeaconTemplateId,
                                (await helpers.time.latest()) - 24 * 60 * 60
                              );
                              const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
                              await expect(
                                dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                  ...executeDapiFallbackArgs,
                                  dapiFallbackAdminInd: dapiFallbackAdminId,
                                })
                              ).to.have.been.revertedWith('Fallback feed stale');
                            });
                          });
                        });
                        context('Data feed has not been initialized', function () {
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
                            const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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
                              dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback({
                                ...executeDapiFallbackArgs,
                                dapiFallbackAdminInd: dapiFallbackAdminId,
                              })
                            ).to.have.been.revertedWith('Data feed not initialized');
                          });
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
                          const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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
                            dapiFallbackAdminInd: dapiFallbackAdminId,
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
                            dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                          ).to.have.been.revertedWith('Invalid tree proof');
                        });
                      });
                    });
                    context('Tree root not registered', function () {
                      it('reverts', async function () {
                        const { roles, dapiFallbackV2, updateParams, priceRoot, priceProof, duration, price } =
                          await helpers.loadFixture(deploy);
                        const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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
                          dapiFallbackAdminInd: dapiFallbackAdminId,
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
                          dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                        ).to.have.been.revertedWith('Tree root not registered');
                      });
                    });
                  });
                  context('Data feed ID will not change', function () {
                    it('reverts', async function () {
                      const {
                        roles,
                        api3ServerV1,
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
                      const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
                      await api3ServerV1
                        .connect(roles.manager)
                        .setDapiName(hre.ethers.utils.formatBytes32String(dapiName), fallbackBeaconId);
                      const executeDapiFallbackArgs = {
                        dapiFallbackAdminInd: dapiFallbackAdminId,
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
                        dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                      ).to.have.been.revertedWith('Data feed ID will not change');
                    });
                  });
                });
                context('Invalid update parameters', function () {
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
                    const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
                    const deviationThresholdInPercentage = hre.ethers.utils.parseUnits('25', 4); // 0.25%
                    const heartbeatInterval = 86400; // 1 day in seconds
                    const deviationReference = 0;

                    const unmatchedUpdateParams = hre.ethers.utils.defaultAbiCoder.encode(
                      ['uint256', 'int224', 'uint256'],
                      [deviationThresholdInPercentage, deviationReference, heartbeatInterval]
                    );
                    const executeDapiFallbackArgs = {
                      dapiFallbackAdminInd: dapiFallbackAdminId,
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
                      dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                    ).to.have.been.revertedWith('Invalid update parameters');
                  });
                });
              });
              context('Sponsor wallet address zero', function () {
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
                  const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
                  const zeroAddress = hre.ethers.constants.AddressZero;
                  const executeDapiFallbackArgs = {
                    dapiFallbackAdminInd: dapiFallbackAdminId,
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
                    dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                  ).to.have.been.revertedWith('Sponsor wallet address zero');
                });
              });
            });
            context('Price zero', function () {
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
                const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
                const executeDapiFallbackArgs = {
                  dapiFallbackAdminInd: dapiFallbackAdminId,
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
                  dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
                ).to.have.been.revertedWith('Price zero');
              });
            });
          });
          context('Duration zero', function () {
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
              const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
              const executeDapiFallbackArgs = {
                dapiFallbackAdminInd: dapiFallbackAdminId,
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
                dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
              ).to.have.been.revertedWith('Duration zero');
            });
          });
        });
        context('Data feed ID zero', function () {
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
            const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
            const zeroDatafeedID = hre.ethers.constants.HashZero;
            const executeDapiFallbackArgs = {
              dapiFallbackAdminInd: dapiFallbackAdminId,
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
              dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
            ).to.have.been.revertedWith('Data feed ID zero');
          });
        });
      });
      context('dAPI name zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2, updateParams, priceRoot, priceProof, duration, price } =
            await helpers.loadFixture(deploy);
          const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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
            dapiFallbackAdminInd: dapiFallbackAdminId,
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
            dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
          ).to.have.been.revertedWith('dAPI name zero');
        });
      });
    });
    context('Sender is not the dAPI fallback admin with the ID', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2, duration, price } = await helpers.loadFixture(deploy);
        const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
        const executeDapiFallbackArgs = {
          dapiFallbackAdminInd: (dapiFallbackAdminId + 1) % 3,
          dapiName: generateRandomBytes32(),
          dataFeedId: generateRandomBytes32(),
          fallbackRoot: generateRandomBytes32(),
          fallbackProof: [],
          updateParams: generateRandomBytes(),
          priceRoot: generateRandomBytes32(),
          priceProof: [],
          duration,
          price,
          sponsorWallet: generateRandomAddress(),
        };
        await expect(
          dapiFallbackV2.connect(dapiFallbackAdmin).executeDapiFallback(executeDapiFallbackArgs)
        ).to.have.been.revertedWith('Sender not admin with ID');
        await expect(
          dapiFallbackV2.connect(roles.randomPerson).executeDapiFallback(executeDapiFallbackArgs)
        ).to.have.been.revertedWith('Sender not admin with ID');
      });
    });
  });

  describe('revertDapiFallback', function () {
    context('Sender is the owner', function () {
      context('dAPI fallback has been executed', function () {
        it('reverts dAPI fallback', async function () {
          const {
            roles,
            api3ServerV1,
            dapiFallbackV2,
            dapiName,
            fallbackBeaconTemplateId,
            executeDapiFallbackArgs,
            dapiDataRegistry,
            dataFeeds,
            dapiTree,
            dapiTreeValues,
          } = await helpers.loadFixture(deploy);
          const { dapiFallbackAdminId, dapiFallbackAdmin } = getRandomDapiFallbackAdmin(roles);
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

          await updateBeacon(roles.airnode1, api3ServerV1, fallbackBeaconTemplateId, await helpers.time.latest());
          await updateBeaconSet(
            [roles.airnode1, roles.airnode2, roles.airnode3, roles.airnode4, roles.airnode5],
            api3ServerV1,
            templateIds,
            await helpers.time.latest()
          );

          await dapiFallbackV2
            .connect(dapiFallbackAdmin)
            .executeDapiFallback({ ...executeDapiFallbackArgs, dapiFallbackAdminInd: dapiFallbackAdminId });
          expect(await dapiFallbackV2.getRevertableDapiFallbacks()).to.deep.equal([
            hre.ethers.utils.formatBytes32String(dapiName),
          ]);

          await expect(
            dapiFallbackV2
              .connect(roles.owner)
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
          expect(await dapiFallbackV2.getRevertableDapiFallbacks()).to.deep.equal([]);
        });
      });
      context('dAPI fallback has not been executed', function () {
        it('reverts', async function () {
          const {
            roles,
            api3ServerV1,
            dapiFallbackV2,
            dapiName,
            fallbackBeaconTemplateId,
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

          await updateBeacon(roles.airnode1, api3ServerV1, fallbackBeaconTemplateId, await helpers.time.latest());
          await updateBeaconSet(
            [roles.airnode1, roles.airnode2, roles.airnode3, roles.airnode4, roles.airnode5],
            api3ServerV1,
            templateIds,
            await helpers.time.latest()
          );

          await expect(
            dapiFallbackV2
              .connect(roles.owner)
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
          ).to.have.been.revertedWith('Fallback not revertable');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2, dapiName } = await helpers.loadFixture(deploy);

        await expect(
          dapiFallbackV2
            .connect(roles.randomPerson)
            .revertDapiFallback(
              hre.ethers.utils.formatBytes32String(dapiName),
              generateRandomBytes32(),
              generateRandomAddress(),
              1,
              0,
              86400,
              generateRandomBytes32(),
              []
            )
        ).to.have.been.revertedWith('Ownable: caller is not the owner');
      });
    });
  });
});

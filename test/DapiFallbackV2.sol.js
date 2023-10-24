const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const {
  generateRandomBytes32,
  generateRandomAddress,
  buildEIP712Domain,
  generateRandomBytes,
} = require('./test-utils');

describe.only('DapiFallbackV2', function () {
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
      'airnode',
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

    const DapiFallbackV2 = await hre.ethers.getContractFactory('DapiFallbackV2', roles.deployer);
    const dapiFallbackV2 = await DapiFallbackV2.deploy(api3ServerV1.address, hashRegistry.address);
    await dapiFallbackV2.connect(roles.deployer).transferOwnership(roles.dapiFallbackV2Owner.address);

    /*     const rootRole = deriveRootRole(roles.manager.address);

    await accessControlRegistry.connect(roles.manager).grantRole(registrarRole, roles.api3MarketContract.address); */

    /*     await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(rootRole, api3ServerV1AdminRoleDescription);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        await api3ServerV1.adminRole(),
        await api3ServerV1.DAPI_NAME_SETTER_ROLE_DESCRIPTION()
      ); */
    /*     await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await api3ServerV1.dapiNameSetterRole(), dapiFallbackV2.address); */

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
      [roles.airnode.address, fallbackBeaconTemplateId]
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

    const dapiFallbackHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI fallback merkle tree root']);
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
    const priceTreeEntry = [
      hre.ethers.utils.formatBytes32String(dapiName),
      chainId,
      generateRandomBytes(),
      duration,
      price,
    ];
    const priceTreeValues = [
      [generateRandomBytes32(), 1, generateRandomBytes(), 2592000, hre.ethers.utils.parseEther('1')],
      [generateRandomBytes32(), 2, generateRandomBytes(), 2592001, hre.ethers.utils.parseEther('2')],
      priceTreeEntry,
      [generateRandomBytes32(), 3, generateRandomBytes(), 2592002, hre.ethers.utils.parseEther('4')],
      [generateRandomBytes32(), 4, generateRandomBytes(), 2592003, hre.ethers.utils.parseEther('5')],
    ];
    const priceTree = StandardMerkleTree.of(priceTreeValues, ['bytes32', 'uint256', 'bytes', 'uint256', 'uint256']);
    const priceRoot = priceTree.root;

    const priceHashType = hre.ethers.utils.solidityKeccak256(['string'], ['Price merkle tree root']);
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

    return {
      roles,
      api3ServerV1,
      dapiFallbackV2,
      hashRegistry,
      accessControlRegistry,
      dapiName,
      fallbackBeaconTemplateId,
      fallbackBeaconId,
      fallbackSponsorWalletAddress,
      domain,
      types,
      dapiFallbackHashType,
      fallbackRoot,
      timestamp,
      fallbackSignatures,
      priceSignatures,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const { roles, api3ServerV1, dapiFallbackV2, hashRegistry } = await helpers.loadFixture(deploy);
      expect(await dapiFallbackV2.owner()).to.equal(roles.dapiFallbackV2Owner.address);
      expect(await dapiFallbackV2.DAPI_FALLBACK_HASH_TYPE()).to.equal(
        hre.ethers.utils.solidityKeccak256(['string'], ['dAPI fallback merkle tree root'])
      );
      expect(await dapiFallbackV2.PRICE_HASH_TYPE()).to.equal(
        hre.ethers.utils.solidityKeccak256(['string'], ['Price merkle tree root'])
      );
      expect(await dapiFallbackV2.api3ServerV1()).to.equal(api3ServerV1.address);
      expect(await dapiFallbackV2.hashRegistry()).to.equal(hashRegistry.address);
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
                await roles.randomPerson.sendTransaction({
                  to: dapiFallbackV2.address,
                  value: hre.ethers.utils.parseEther('33'),
                });
                const initialBalance = await hre.ethers.provider.getBalance(roles.randomPerson.address);
                await dapiFallbackV2
                  .connect(roles.dapiFallbackV2Owner)
                  .withdraw(roles.randomPerson.address, hre.ethers.utils.parseEther('1'));
                const finalBalance = await hre.ethers.provider.getBalance(roles.randomPerson.address);
                expect(finalBalance.sub(initialBalance)).to.equal(hre.ethers.utils.parseEther('1'));
              });
            });
            context('Low level call reverts', function () {
              it('reverts', async function () {
                const { roles, dapiFallbackV2, accessControlRegistry } = await helpers.loadFixture(deploy);
                await roles.randomPerson.sendTransaction({
                  to: dapiFallbackV2.address,
                  value: hre.ethers.utils.parseEther('33'),
                });
                await expect(
                  dapiFallbackV2
                    .connect(roles.dapiFallbackV2Owner)
                    .withdraw(accessControlRegistry.address, hre.ethers.utils.parseEther('33'))
                ).to.be.revertedWith('Failed to withdraw');
              });
            });
          });
          context('Contract does not have funds', function () {
            it('reverts', async function () {
              const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
              await expect(
                dapiFallbackV2
                  .connect(roles.dapiFallbackV2Owner)
                  .withdraw(roles.randomPerson.address, hre.ethers.utils.parseEther('33'))
              ).to.be.revertedWith('Insufficient contract balance');
            });
          });
        });
        context('Amount is zero', function () {
          it('reverts', async function () {
            const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
            await roles.randomPerson.sendTransaction({
              to: dapiFallbackV2.address,
              value: hre.ethers.utils.parseEther('33'),
            });
            await expect(
              dapiFallbackV2.connect(roles.dapiFallbackV2Owner).withdraw(roles.randomPerson.address, 0)
            ).to.be.revertedWith('Amount zero');
          });
        });
      });
      context('Recipient address is zero', function () {
        it('reverts', async function () {
          const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
          await roles.randomPerson.sendTransaction({
            to: dapiFallbackV2.address,
            value: hre.ethers.utils.parseEther('33'),
          });
          await expect(
            dapiFallbackV2
              .connect(roles.dapiFallbackV2Owner)
              .withdraw(hre.ethers.constants.AddressZero, hre.ethers.utils.parseEther('33'))
          ).to.be.revertedWith('Recipient address zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiFallbackV2 } = await helpers.loadFixture(deploy);
        await roles.randomPerson.sendTransaction({
          to: dapiFallbackV2.address,
          value: hre.ethers.utils.parseEther('33'),
        });
        await expect(
          dapiFallbackV2
            .connect(roles.randomPerson)
            .withdraw(roles.randomPerson.address, hre.ethers.utils.parseEther('33'))
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });
});

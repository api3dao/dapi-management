const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');

describe('Api3Market', function () {
  const deploy = async () => {
    const roleNames = ['deployer', 'owner', 'manager', 'randomPerson'];
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

    return {
      roles,
      hashRegistry,
      dapiDataRegistry,
      dapiFallbackV2,
      proxyFactory,
      api3ServerV1,
      api3Market,
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
});

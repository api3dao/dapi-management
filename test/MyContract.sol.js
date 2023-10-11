const { ethers } = require('hardhat');
const { expect } = require('chai');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

describe('MyContract', function () {
  async function deploy() {
    const accounts = await ethers.getSigners();
    const roles = {
      deployer: accounts[0],
      randomPerson: accounts[9],
    };

    const MyContract = await ethers.getContractFactory('MyContract', roles.deployer);
    const myContract = await MyContract.deploy();
    return { myContract };
  }

  describe('constructor', function () {
    it('constructs', async function () {
      const { myContract } = await helpers.loadFixture(deploy);
      expect(myContract.address).to.not.be.undefined;
    });
  });
});

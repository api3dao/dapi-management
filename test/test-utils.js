const { ethers } = require('hardhat');

module.exports = {
  generateRandomAirnodeWallet: () => {
    const airnodeWallet = ethers.Wallet.createRandom();
    const airnodeMnemonic = airnodeWallet.mnemonic.phrase;
    const hdNode = ethers.utils.HDNode.fromMnemonic(airnodeMnemonic).derivePath("m/44'/60'/0'");
    const airnodeXpub = hdNode.neuter().extendedKey;
    return { airnodeAddress: airnodeWallet.address, airnodeMnemonic, airnodeXpub };
  },
  generateRandomAddress: () => {
    return ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
  },
  generateRandomBytes32: () => {
    return ethers.utils.hexlify(ethers.utils.randomBytes(32));
  },
  generateRandomBytes: () => {
    return ethers.utils.hexlify(ethers.utils.randomBytes(256));
  },
  getCurrentTimestamp: async (provider) => {
    return (await provider.getBlock()).timestamp;
  },
  decodeRevertString: (callData) => {
    // Refer to https://ethereum.stackexchange.com/a/83577
    try {
      // Skip the signature, only get the revert string
      return ethers.utils.defaultAbiCoder.decode(['string'], `0x${callData.substring(2 + 4 * 2)}`)[0];
    } catch {
      return 'No revert string';
    }
  },
  deriveRootRole: (managerAddress) => {
    return ethers.utils.solidityKeccak256(['address'], [managerAddress]);
  },
  deriveRole: (adminRole, roleDescription) => {
    return ethers.utils.solidityKeccak256(
      ['bytes32', 'bytes32'],
      [adminRole, ethers.utils.solidityKeccak256(['string'], [roleDescription])]
    );
  },
  buildEIP712Domain: (name, chainId, verifyingContract) => {
    return {
      name,
      version: '1.0.0',
      chainId,
      verifyingContract,
    };
  },
  expiringMetaTxDomain: async (expiringMetaTxForwarder) => {
    const chainId = (await expiringMetaTxForwarder.provider.getNetwork()).chainId;
    return module.exports.buildEIP712Domain('ExpiringMetaTxForwarder', chainId, expiringMetaTxForwarder.address);
  },
  expiringMetaTxTypes: () => {
    return {
      ExpiringMetaTx: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'data', type: 'bytes' },
        { name: 'expirationTimestamp', type: 'uint256' },
      ],
    };
  },
  signData: async (airnode, templateId, timestamp, data) => {
    return await airnode.signMessage(
      ethers.utils.arrayify(
        ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, data])
      )
    );
  },
};

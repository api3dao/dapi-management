const airnodeProtocolV1 = require('@api3/airnode-protocol-v1');
const { hashSigners: dapiHashSigners } = require('../data/dapi-management-merkle-tree-root/hash-signers.json');

module.exports = async ({ deployments, getUnnamedAccounts, ethers, network }) => {
  const { deploy, log } = deployments;
  const [deployer, ...rest] = await getUnnamedAccounts();

  const deployerSigner = await ethers.getSigner(deployer);

  let ownableCallForwarderAddress;
  let accessControlRegistryAddress;
  let api3ServerV1Address;
  let proxyFactoryAddress;
  let dapiFallbackManagers;
  if (network.name === 'localhost' || network.name === 'hardhat') {
    const [localhostOwnableCallForwarderAddress, dapiFallbackManager1, dapiFallbackManager2, dapiFallbackManager3] =
      rest;
    ownableCallForwarderAddress = localhostOwnableCallForwarderAddress;

    const { address: localhostAccessControlRegistryAddress } = await deploy('AccessControlRegistry', {
      from: deployerSigner.address,
      log: true,
    });
    accessControlRegistryAddress = localhostAccessControlRegistryAddress;
    log(`Deployed AccessControlRegistry at ${localhostAccessControlRegistryAddress}`);

    const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
    const { address: localhostApi3ServerV1Address } = await deploy('MockApi3ServerV1', {
      args: [
        localhostAccessControlRegistryAddress,
        api3ServerV1AdminRoleDescription,
        localhostOwnableCallForwarderAddress,
      ],
      from: deployerSigner.address,
      log: true,
    });
    api3ServerV1Address = localhostApi3ServerV1Address;
    log(`Deployed Api3ServerV1 at ${localhostApi3ServerV1Address}`);

    const { address: localhostProxyFactoryAddress } = await deploy('ProxyFactory', {
      args: [localhostApi3ServerV1Address],
      from: deployerSigner.address,
      log: true,
    });
    proxyFactoryAddress = localhostProxyFactoryAddress;
    log(`Deployed ProxyFactory at ${localhostProxyFactoryAddress}`);

    dapiFallbackManagers = [dapiFallbackManager1, dapiFallbackManager2, dapiFallbackManager3];
  } else {
    ownableCallForwarderAddress = airnodeProtocolV1.references.OwnableCallForwarder[network.config.chainId.toString()];
    accessControlRegistryAddress =
      airnodeProtocolV1.references.AccessControlRegistry[network.config.chainId.toString()];
    api3ServerV1Address = airnodeProtocolV1.references.Api3ServerV1[network.config.chainId.toString()];
    proxyFactoryAddress = airnodeProtocolV1.references.ProxyFactory[network.config.chainId.toString()];

    dapiFallbackManagers = dapiHashSigners;
  }

  const { address: hashRegistryAddress, abi: hashRegistryAbi } = await deploy('HashRegistry', {
    from: deployer,
    args: [ownableCallForwarderAddress],
    log: true,
    deterministicDeployment: ethers.constants.HashZero,
  });
  log(`Deployed HashRegistry at ${hashRegistryAddress}`);

  const hashRegistry = new ethers.Contract(hashRegistryAddress, hashRegistryAbi, deployerSigner);
  if ((await hashRegistry.owner()) !== ownableCallForwarderAddress) {
    const tx = await hashRegistry.transferOwnership(ownableCallForwarderAddress);
    await tx.wait();
    log(`Transferred HashRegistry ownership to ${ownableCallForwarderAddress}`);
  }

  const dapiDataRegistryAdminRoleDescription = 'DapiDataRegistry admin';
  const { address: dapiDataRegistryAddress } = await deploy('DapiDataRegistry', {
    from: deployer,
    args: [
      accessControlRegistryAddress,
      dapiDataRegistryAdminRoleDescription,
      ownableCallForwarderAddress,
      hashRegistryAddress,
      api3ServerV1Address,
    ],
    log: true,
    deterministicDeployment: ethers.constants.HashZero,
  });
  log(`Deployed DapiDataRegistry at ${dapiDataRegistryAddress}`);

  const { address: dapiFallbackV2Address } = await deploy('DapiFallbackV2', {
    from: deployer,
    args: [api3ServerV1Address, hashRegistryAddress, dapiDataRegistryAddress, dapiFallbackManagers],
    log: true,
    deterministicDeployment: ethers.constants.HashZero,
  });
  log(`Deployed DapiFallbackV2 at ${dapiFallbackV2Address}`);

  const { address: api3MarketAddress } = await deploy('Api3Market', {
    from: deployer,
    args: [
      hashRegistryAddress,
      dapiDataRegistryAddress,
      dapiFallbackV2Address,
      proxyFactoryAddress,
      api3ServerV1Address,
    ],
    log: true,
    deterministicDeployment: ethers.constants.HashZero,
  });
  log(`Deployed Api3Market at ${api3MarketAddress}`);
};

module.exports.tags = ['deploy'];

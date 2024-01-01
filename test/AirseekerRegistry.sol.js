const { ethers } = require('hardhat');
const { expect } = require('chai');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

describe('AirseekerRegistry', function () {
  const MAXIMUM_BEACON_COUNT_IN_SET = 21;

  function deriveTemplateId(oisTitle, feedName) {
    const endpointId = ethers.utils.solidityKeccak256(['string', 'string'], [oisTitle, 'feed']);
    // Parameters encoded in Airnode ABI
    // https://docs.api3.org/reference/airnode/latest/specifications/airnode-abi.html
    return ethers.utils.solidityKeccak256(
      ['bytes32', 'bytes'],
      [
        endpointId,
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32'],
          [
            ethers.utils.formatBytes32String('1b'),
            ethers.utils.formatBytes32String('name'),
            ethers.utils.formatBytes32String(feedName),
          ]
        ),
      ]
    );
  }

  function deriveBeaconId(airnodeAddress, templateId) {
    return ethers.utils.solidityKeccak256(['address', 'bytes32'], [airnodeAddress, templateId]);
  }

  function deriveBeaconSetId(beaconIds) {
    return ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['bytes32[]'], [beaconIds]));
  }

  async function updateBeaconSet(api3ServerV1, feedName, airnodes, timestamp, value) {
    const encodedValue = ethers.utils.defaultAbiCoder.encode(['int224'], [value]);
    const beaconUpdateData = airnodes.map((airnode) => {
      const templateId = deriveTemplateId(`OIS title of Airnode with address ${airnode.address}`, feedName);
      return {
        templateId,
        beaconId: deriveBeaconId(airnode.address, templateId),
        signature: airnode.signMessage(
          ethers.utils.arrayify(
            ethers.utils.solidityKeccak256(['bytes32', 'uint256', 'bytes'], [templateId, timestamp, encodedValue])
          )
        ),
      };
    });
    for (let i = 0; i < airnodes.length; i++) {
      await api3ServerV1.updateBeaconWithSignedData(
        airnodes[i].address,
        beaconUpdateData[i].templateId,
        timestamp,
        encodedValue,
        beaconUpdateData[i].signature
      );
    }
    const beaconIds = beaconUpdateData.map((beaconUpdateDatum) => beaconUpdateDatum.beaconId);
    await api3ServerV1.updateBeaconSetWithBeacons(beaconIds);
    return deriveBeaconSetId(beaconIds);
  }

  async function registerBeaconSet(airseekerRegistry, feedName, airnodes) {
    const beacons = airnodes
      .map((airnode) => {
        return {
          airnodeAddress: airnode.address,
          templateId: deriveTemplateId(`OIS title of Airnode with address ${airnode.address}`, feedName),
        };
      })
      .map((beacon) => {
        return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
      });
    const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'bytes32[]'],
      [beacons.map((beacon) => beacon.airnodeAddress), beacons.map((beacon) => beacon.templateId)]
    );
    await airseekerRegistry.registerDataFeed(dataFeedDetails);
    return dataFeedDetails;
  }

  async function deploy() {
    const roleNames = ['deployer', 'api3ServerV1Manager', 'airnode1', 'airnode2', 'airnode3', 'owner', 'randomPerson'];
    const accounts = await ethers.getSigners();
    const roles = roleNames.reduce((acc, roleName, index) => {
      return { ...acc, [roleName]: accounts[index] };
    }, {});
    const airnodes = Object.keys(roles).reduce((acc, roleName) => {
      if (roleName.startsWith('airnode')) {
        return [...acc, roles[roleName]];
      }
      return acc;
    }, []);

    const AccessControlRegistry = await ethers.getContractFactory('AccessControlRegistry', roles.deployer);
    const accessControlRegistry = await AccessControlRegistry.deploy();

    const api3ServerV1AdminRoleDescription = 'Api3ServerV1 admin';
    const Api3ServerV1 = await ethers.getContractFactory('Api3ServerV1', roles.deployer);
    const api3ServerV1 = await Api3ServerV1.deploy(
      accessControlRegistry.address,
      api3ServerV1AdminRoleDescription,
      roles.api3ServerV1Manager.address
    );
    const dataFeedId = await updateBeaconSet(
      api3ServerV1,
      'ETH/USD',
      airnodes,
      await helpers.time.latest(),
      ethers.utils.parseEther('2200')
    );
    const dapiName = ethers.utils.formatBytes32String('ETH/USD');
    await api3ServerV1.connect(roles.api3ServerV1Manager).setDapiName(dapiName, dataFeedId);

    const AirseekerRegistry = await ethers.getContractFactory('AirseekerRegistry', roles.deployer);
    const airseekerRegistry = await AirseekerRegistry.deploy(roles.owner.address, api3ServerV1.address);
    const signedApiUrls = airnodes.map((_, index) => `https://signed-api.airnode${index}.com`);
    for (let ind = 0; ind < airnodes.length; ind++) {
      await airseekerRegistry.connect(roles.owner).setSignedApiUrl(airnodes[ind].address, signedApiUrls[ind]);
    }

    return {
      roles,
      airnodes,
      api3ServerV1,
      dataFeedId,
      dapiName,
      airseekerRegistry,
      signedApiUrls,
    };
  }

  describe('constructor', function () {
    context('Owner address is not zero', function () {
      context('Api3ServerV1 address is not zero', function () {
        it('constructs', async function () {
          const { roles, api3ServerV1, airseekerRegistry } = await helpers.loadFixture(deploy);
          expect(await airseekerRegistry.owner()).to.equal(roles.owner.address);
          expect(await airseekerRegistry.api3ServerV1()).to.equal(api3ServerV1.address);
        });
      });
      context('Api3ServerV1 address is zero', function () {
        it('reverts', async function () {
          const { roles } = await helpers.loadFixture(deploy);
          const AirseekerRegistry = await ethers.getContractFactory('AirseekerRegistry', roles.deployer);
          await expect(AirseekerRegistry.deploy(roles.owner.address, ethers.constants.AddressZero)).to.be.revertedWith(
            'Api3ServerV1 address zero'
          );
        });
      });
    });
    context('Owner address is zero', function () {
      it('reverts', async function () {
        const { roles, api3ServerV1 } = await helpers.loadFixture(deploy);
        const AirseekerRegistry = await ethers.getContractFactory('AirseekerRegistry', roles.deployer);
        await expect(AirseekerRegistry.deploy(ethers.constants.AddressZero, api3ServerV1.address)).to.be.revertedWith(
          'Owner address zero'
        );
      });
    });
  });

  describe('renounceOwnership', function () {
    it('reverts', async function () {
      const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
      await expect(airseekerRegistry.connect(roles.owner).renounceOwnership()).to.be.revertedWith(
        'Ownership cannot be renounced'
      );
    });
  });

  describe('transferOwnership', function () {
    it('reverts', async function () {
      const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
      await expect(
        airseekerRegistry.connect(roles.owner).transferOwnership(roles.randomPerson.address)
      ).to.be.revertedWith('Ownership cannot be transferred');
    });
  });

  describe('setDataFeedIdToBeActivated', function () {
    context('Sender is the owner', function () {
      context('Data feed ID is not zero', function () {
        context('Data feed ID is not activated', function () {
          it('activates the data feed ID', async function () {
            const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDataFeedIdCount()).to.equal(0);
            await expect(airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId))
              .to.emit(airseekerRegistry, 'ActivatedDataFeedId')
              .withArgs(dataFeedId);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(1);
            expect(await airseekerRegistry.activeDataFeedIdCount()).to.equal(1);
            const dataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(dataFeed.dataFeedId).to.equal(dataFeedId);
          });
        });
        context('Data feed ID is already activated', function () {
          it('does nothing', async function () {
            const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
            await expect(airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId)).to.not.emit(
              airseekerRegistry,
              'ActivatedDataFeedId'
            );
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(1);
            expect(await airseekerRegistry.activeDataFeedIdCount()).to.equal(1);
            const dataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(dataFeed.dataFeedId).to.equal(dataFeedId);
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          await expect(
            airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(ethers.constants.HashZero)
          ).to.be.revertedWith('Data feed ID zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDataFeedIdToBeActivated(dataFeedId)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setDapiNameToBeActivated', function () {
    context('Sender is the owner', function () {
      context('dAPI name is not zero', function () {
        context('dAPI name is not activated', function () {
          it('activates the dAPI name', async function () {
            const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDapiNameCount()).to.equal(0);
            await expect(airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName))
              .to.emit(airseekerRegistry, 'ActivatedDapiName')
              .withArgs(dapiName);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(1);
            expect(await airseekerRegistry.activeDapiNameCount()).to.equal(1);
            const dataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(dataFeed.dapiName).to.equal(dapiName);
          });
        });
        context('dAPI name is already activated', function () {
          it('does nothing', async function () {
            const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
            await expect(airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName)).to.not.emit(
              airseekerRegistry,
              'ActivatedDapiName'
            );
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(1);
            expect(await airseekerRegistry.activeDapiNameCount()).to.equal(1);
            const dataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(dataFeed.dapiName).to.equal(dapiName);
          });
        });
      });
      context('dAPI name is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          await expect(
            airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(ethers.constants.HashZero)
          ).to.be.revertedWith('dAPI name zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDapiNameToBeActivated(dapiName)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setDataFeedIdToBeDeactivated', function () {
    context('Sender is the owner', function () {
      context('Data feed ID is not zero', function () {
        context('Data feed ID is activated', function () {
          it('activates the data feed ID', async function () {
            const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
            await expect(airseekerRegistry.connect(roles.owner).setDataFeedIdToBeDeactivated(dataFeedId))
              .to.emit(airseekerRegistry, 'DeactivatedDataFeedId')
              .withArgs(dataFeedId);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDataFeedIdCount()).to.equal(0);
          });
        });
        context('Data feed ID is not activated', function () {
          it('does nothing', async function () {
            const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            await expect(airseekerRegistry.connect(roles.owner).setDataFeedIdToBeDeactivated(dataFeedId)).to.not.emit(
              airseekerRegistry,
              'DeactivatedDataFeedId'
            );
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDataFeedIdCount()).to.equal(0);
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          await expect(
            airseekerRegistry.connect(roles.owner).setDataFeedIdToBeDeactivated(ethers.constants.HashZero)
          ).to.be.revertedWith('Data feed ID zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDataFeedIdToBeDeactivated(dataFeedId)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setDapiNameToBeDeactivated', function () {
    context('Sender is the owner', function () {
      context('dAPI name is not zero', function () {
        context('dAPI name is activated', function () {
          it('activates the dAPI name', async function () {
            const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
            await expect(airseekerRegistry.connect(roles.owner).setDapiNameToBeDeactivated(dapiName))
              .to.emit(airseekerRegistry, 'DeactivatedDapiName')
              .withArgs(dapiName);
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDapiNameCount()).to.equal(0);
          });
        });
        context('dAPI name is not activated', function () {
          it('does nothing', async function () {
            const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            await expect(airseekerRegistry.connect(roles.owner).setDapiNameToBeDeactivated(dapiName)).to.not.emit(
              airseekerRegistry,
              'DeactivatedDataFeedId'
            );
            expect(await airseekerRegistry.activeDataFeedCount()).to.equal(0);
            expect(await airseekerRegistry.activeDapiNameCount()).to.equal(0);
          });
        });
      });
      context('dAPI name is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          await expect(
            airseekerRegistry.connect(roles.owner).setDapiNameToBeDeactivated(ethers.constants.HashZero)
          ).to.be.revertedWith('dAPI name zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDapiNameToBeDeactivated(dapiName)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setDataFeedIdUpdateParameters', function () {
    context('Sender is the owner', function () {
      context('Data feed ID is not zero', function () {
        context('Values update update parameters', function () {
          context('Values have not been used before', function () {
            it('updates update parameters', async function () {
              const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              expect(await airseekerRegistry.dataFeedIdToUpdateParameters(dataFeedId)).to.equal('0x');
              await expect(
                airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters)
              )
                .to.emit(airseekerRegistry, 'UpdatedDataFeedIdUpdateParameters')
                .withArgs(dataFeedId, updateParameters);
              expect(await airseekerRegistry.dataFeedIdToUpdateParameters(dataFeedId)).to.equal(updateParameters);
            });
          });
          context('Values have been used before', function () {
            it('updates update parameters', async function () {
              const { roles, dataFeedId, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
              expect(await airseekerRegistry.dataFeedIdToUpdateParameters(dataFeedId)).to.equal('0x');
              await expect(
                airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters)
              )
                .to.emit(airseekerRegistry, 'UpdatedDataFeedIdUpdateParameters')
                .withArgs(dataFeedId, updateParameters);
              expect(await airseekerRegistry.dataFeedIdToUpdateParameters(dataFeedId)).to.equal(updateParameters);
            });
          });
        });
        context('Values do not update update parameters', function () {
          it('does nothing', async function () {
            const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            const updateParameters = ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'int224', 'uint256'],
              [1000000, 0, 24 * 60 * 60]
            );
            await airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters);
            await expect(
              airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters)
            ).to.not.emit(airseekerRegistry, 'UpdatedDataFeedIdUpdateParameters');
            expect(await airseekerRegistry.dataFeedIdToUpdateParameters(dataFeedId)).to.equal(updateParameters);
          });
        });
      });
      context('Data feed ID is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          const updateParameters = ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'int224', 'uint256'],
            [1000000, 0, 24 * 60 * 60]
          );
          await expect(
            airseekerRegistry
              .connect(roles.owner)
              .setDataFeedIdUpdateParameters(ethers.constants.HashZero, updateParameters)
          ).to.be.revertedWith('Data feed ID zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
        const updateParameters = ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'int224', 'uint256'],
          [1000000, 0, 24 * 60 * 60]
        );
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDataFeedIdUpdateParameters(dataFeedId, updateParameters)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setDapiNameUpdateParameters', function () {
    context('Sender is the owner', function () {
      context('dAPI name is not zero', function () {
        context('Values update update parameters', function () {
          context('Values have not been used before', function () {
            it('updates update parameters', async function () {
              const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              expect(await airseekerRegistry.dapiNameToUpdateParameters(dapiName)).to.equal('0x');
              await expect(
                airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters)
              )
                .to.emit(airseekerRegistry, 'UpdatedDapiNameUpdateParameters')
                .withArgs(dapiName, updateParameters);
              expect(await airseekerRegistry.dapiNameToUpdateParameters(dapiName)).to.equal(updateParameters);
            });
          });
          context('Values have been used before', function () {
            it('updates update parameters', async function () {
              const { roles, dataFeedId, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              await airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters);
              expect(await airseekerRegistry.dapiNameToUpdateParameters(dapiName)).to.equal('0x');
              await expect(
                airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters)
              )
                .to.emit(airseekerRegistry, 'UpdatedDapiNameUpdateParameters')
                .withArgs(dapiName, updateParameters);
              expect(await airseekerRegistry.dapiNameToUpdateParameters(dapiName)).to.equal(updateParameters);
            });
          });
        });
        context('Values do not update update parameters', function () {
          it('does nothing', async function () {
            const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            const updateParameters = ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'int224', 'uint256'],
              [1000000, 0, 24 * 60 * 60]
            );
            await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
            await expect(
              airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters)
            ).to.not.emit(airseekerRegistry, 'UpdatedDapiNameUpdateParameters');
            expect(await airseekerRegistry.dapiNameToUpdateParameters(dapiName)).to.equal(updateParameters);
          });
        });
      });
      context('dAPI name is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          const updateParameters = ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'int224', 'uint256'],
            [1000000, 0, 24 * 60 * 60]
          );
          await expect(
            airseekerRegistry
              .connect(roles.owner)
              .setDapiNameUpdateParameters(ethers.constants.HashZero, updateParameters)
          ).to.be.revertedWith('dAPI name zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
        const updateParameters = ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'int224', 'uint256'],
          [1000000, 0, 24 * 60 * 60]
        );
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setDapiNameUpdateParameters(dapiName, updateParameters)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('setSignedApiUrl', function () {
    context('Sender is the owner', function () {
      context('Airnode address is not zero', function () {
        context('Signed API URL is not too long', function () {
          context('Value updates signed API URL', function () {
            it('updates signed API URL', async function () {
              const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
              const airnodeAddress = ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
              const signedApiUrl = 'https://signed-api.airnode.com';
              expect(await airseekerRegistry.airnodeToSignedApiUrl(airnodeAddress)).to.equal('');
              await expect(airseekerRegistry.connect(roles.owner).setSignedApiUrl(airnodeAddress, signedApiUrl))
                .to.emit(airseekerRegistry, 'UpdatedSignedApiUrl')
                .withArgs(airnodeAddress, signedApiUrl);
              expect(await airseekerRegistry.airnodeToSignedApiUrl(airnodeAddress)).to.equal(signedApiUrl);
            });
          });
          context('Value does not update signed API URL', function () {
            it('does nothing', async function () {
              const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
              const airnodeAddress = ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
              const signedApiUrl = 'https://signed-api.airnode.com';
              await airseekerRegistry.connect(roles.owner).setSignedApiUrl(airnodeAddress, signedApiUrl);
              await expect(
                airseekerRegistry.connect(roles.owner).setSignedApiUrl(airnodeAddress, signedApiUrl)
              ).to.not.emit(airseekerRegistry, 'UpdatedSignedApiUrl');
              expect(await airseekerRegistry.airnodeToSignedApiUrl(airnodeAddress)).to.equal(signedApiUrl);
            });
          });
        });
        context('Signed API URL is too long', function () {
          it('reverts', async function () {
            const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
            const airnodeAddress = ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
            const signedApiUrl = 'X'.repeat(256 + 1);
            await expect(
              airseekerRegistry.connect(roles.owner).setSignedApiUrl(airnodeAddress, signedApiUrl)
            ).to.be.revertedWith('Signed API URL too long');
          });
        });
      });
      context('Airnode address is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          const signedApiUrl = 'https://signed-api.airnode.com';
          await expect(
            airseekerRegistry.connect(roles.owner).setSignedApiUrl(ethers.constants.AddressZero, signedApiUrl)
          ).to.be.revertedWith('Airnode address zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
        const airnodeAddress = ethers.utils.getAddress(ethers.utils.hexlify(ethers.utils.randomBytes(20)));
        const signedApiUrl = 'https://signed-api.airnode.com';
        await expect(
          airseekerRegistry.connect(roles.randomPerson).setSignedApiUrl(airnodeAddress, signedApiUrl)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('registerDataFeed', function () {
    context('Data feed details are long enough to specify a single Beacon', function () {
      context('Airnode address is not zero', function () {
        context('Data feed is not registered', function () {
          it('registers data feed', async function () {
            const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
            const templateId = deriveTemplateId(
              `OIS title of Airnode with address ${roles.airnode1.address}`,
              'ETH/USD'
            );
            const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
            const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes32'],
              [roles.airnode1.address, templateId]
            );
            expect(await airseekerRegistry.dataFeedIdToDetails(beaconId)).to.equal('0x');
            expect(await airseekerRegistry.dataFeedIsRegistered(beaconId)).to.equal(false);
            expect(
              await airseekerRegistry.connect(roles.randomPerson).callStatic.registerDataFeed(dataFeedDetails)
            ).to.equal(beaconId);
            await expect(airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails))
              .to.emit(airseekerRegistry, 'RegisteredDataFeed')
              .withArgs(beaconId, dataFeedDetails);
            expect(await airseekerRegistry.dataFeedIdToDetails(beaconId)).to.equal(dataFeedDetails);
            expect(await airseekerRegistry.dataFeedIsRegistered(beaconId)).to.equal(true);
          });
        });
        context('Data feed is already registered', function () {
          it('does nothing', async function () {
            const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
            const templateId = deriveTemplateId(
              `OIS title of Airnode with address ${roles.airnode1.address}`,
              'ETH/USD'
            );
            const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
            const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes32'],
              [roles.airnode1.address, templateId]
            );
            await airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails);
            expect(
              await airseekerRegistry.connect(roles.randomPerson).callStatic.registerDataFeed(dataFeedDetails)
            ).to.equal(beaconId);
            await expect(airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails)).to.not.emit(
              airseekerRegistry,
              'RegisteredDataFeed'
            );
            expect(await airseekerRegistry.dataFeedIdToDetails(beaconId)).to.equal(dataFeedDetails);
            expect(await airseekerRegistry.dataFeedIsRegistered(beaconId)).to.equal(true);
          });
        });
      });
      context('Airnode address is zero', function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes32'],
            [ethers.constants.AddressZero, ethers.constants.HashZero]
          );
          await expect(
            airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails)
          ).to.be.revertedWith('Airnode address zero');
        });
      });
    });
    context('Data feed details are at least long enough to specify a Beacon set composed of two Beacons', function () {
      context(
        'Data feed details length does not exceed specifications for a Beacon set composed of the maximum number of Beacons',
        function () {
          context('Data feed details data does not trail', function () {
            context('Data feed detail parameter lengths match', function () {
              context('None of the Airnode addresses is zero', function () {
                context('Data feed is not registered', function () {
                  it('registers data feed', async function () {
                    const { roles, airnodes, airseekerRegistry } = await helpers.loadFixture(deploy);
                    const beacons = airnodes
                      .map((airnode) => {
                        return {
                          airnodeAddress: airnode.address,
                          templateId: deriveTemplateId(
                            `OIS title of Airnode with address ${airnode.address}`,
                            'ETH/USD'
                          ),
                        };
                      })
                      .map((beacon) => {
                        return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
                      });
                    const beaconSetId = deriveBeaconSetId(
                      beacons.reduce((acc, beacon) => {
                        return [...acc, beacon.beaconId];
                      }, [])
                    );
                    const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                      ['address[]', 'bytes32[]'],
                      [beacons.map((beacon) => beacon.airnodeAddress), beacons.map((beacon) => beacon.templateId)]
                    );
                    expect(await airseekerRegistry.dataFeedIdToDetails(beaconSetId)).to.equal('0x');
                    expect(await airseekerRegistry.dataFeedIsRegistered(beaconSetId)).to.equal(false);
                    expect(
                      await airseekerRegistry.connect(roles.randomPerson).callStatic.registerDataFeed(dataFeedDetails)
                    ).to.equal(beaconSetId);
                    await expect(airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails))
                      .to.emit(airseekerRegistry, 'RegisteredDataFeed')
                      .withArgs(beaconSetId, dataFeedDetails);
                    expect(await airseekerRegistry.dataFeedIdToDetails(beaconSetId)).to.equal(dataFeedDetails);
                    expect(await airseekerRegistry.dataFeedIsRegistered(beaconSetId)).to.equal(true);
                  });
                });
                context('Data feed is already registered', function () {
                  it('does nothing', async function () {
                    const { roles, airnodes, airseekerRegistry } = await helpers.loadFixture(deploy);
                    const beacons = airnodes
                      .map((airnode) => {
                        return {
                          airnodeAddress: airnode.address,
                          templateId: deriveTemplateId(
                            `OIS title of Airnode with address ${airnode.address}`,
                            'ETH/USD'
                          ),
                        };
                      })
                      .map((beacon) => {
                        return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
                      });
                    const beaconSetId = deriveBeaconSetId(
                      beacons.reduce((acc, beacon) => {
                        return [...acc, beacon.beaconId];
                      }, [])
                    );
                    const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                      ['address[]', 'bytes32[]'],
                      [beacons.map((beacon) => beacon.airnodeAddress), beacons.map((beacon) => beacon.templateId)]
                    );
                    await airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails);
                    expect(
                      await airseekerRegistry.connect(roles.randomPerson).callStatic.registerDataFeed(dataFeedDetails)
                    ).to.equal(beaconSetId);
                    await expect(
                      airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails)
                    ).to.not.emit(airseekerRegistry, 'RegisteredDataFeed');
                    expect(await airseekerRegistry.dataFeedIdToDetails(beaconSetId)).to.equal(dataFeedDetails);
                    expect(await airseekerRegistry.dataFeedIsRegistered(beaconSetId)).to.equal(true);
                  });
                });
              });
              context('Some of the Airnode addresses are zero', function () {
                it('reverts', async function () {
                  const { roles, airnodes, airseekerRegistry } = await helpers.loadFixture(deploy);
                  const beacons = airnodes
                    .map((airnode) => {
                      return {
                        airnodeAddress: airnode.address,
                        templateId: deriveTemplateId(`OIS title of Airnode with address ${airnode.address}`, 'ETH/USD'),
                      };
                    })
                    .map((beacon) => {
                      return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
                    });
                  const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                    ['address[]', 'bytes32[]'],
                    [
                      [ethers.constants.AddressZero, ...beacons.map((beacon) => beacon.airnodeAddress)],
                      [ethers.constants.HashZero, ...beacons.map((beacon) => beacon.templateId)],
                    ]
                  );
                  await expect(
                    airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetails)
                  ).to.be.revertedWith('Airnode address zero');
                });
              });
            });
            context('Data feed detail parameter lengths do not match', function () {
              it('reverts', async function () {
                const { roles, airnodes, airseekerRegistry } = await helpers.loadFixture(deploy);
                const beacons = airnodes
                  .map((airnode) => {
                    return {
                      airnodeAddress: airnode.address,
                      templateId: deriveTemplateId(`OIS title of Airnode with address ${airnode.address}`, 'ETH/USD'),
                    };
                  })
                  .map((beacon) => {
                    return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
                  });
                const dataFeedDetailsWithParameterLengthMismatch = ethers.utils.defaultAbiCoder.encode(
                  ['address[]', 'bytes32[]'],
                  [
                    beacons.map((beacon) => beacon.airnodeAddress),
                    [beacons[0].templateId, ...beacons.map((beacon) => beacon.templateId)],
                  ]
                );
                await expect(
                  airseekerRegistry
                    .connect(roles.randomPerson)
                    .registerDataFeed(dataFeedDetailsWithParameterLengthMismatch)
                ).to.be.revertedWith('Parameter length mismatch');
              });
            });
          });
          context('Data feed details data trails', function () {
            it('reverts', async function () {
              const { roles, airnodes, airseekerRegistry } = await helpers.loadFixture(deploy);
              const beacons = airnodes
                .map((airnode) => {
                  return {
                    airnodeAddress: airnode.address,
                    templateId: deriveTemplateId(`OIS title of Airnode with address ${airnode.address}`, 'ETH/USD'),
                  };
                })
                .map((beacon) => {
                  return { ...beacon, beaconId: deriveBeaconId(beacon.airnodeAddress, beacon.templateId) };
                });
              const dataFeedDetailsWithTrailingData = `${ethers.utils.defaultAbiCoder.encode(
                ['address[]', 'bytes32[]'],
                [beacons.map((beacon) => beacon.airnodeAddress), beacons.map((beacon) => beacon.templateId)]
              )}00`;
              await expect(
                airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetailsWithTrailingData)
              ).to.be.revertedWith('Feed details data trail');
            });
          });
        }
      );
      context(
        'Data feed details length exceeds specifications for a Beacon set composed of the maximum number of Beacons',
        function () {
          it('reverts', async function () {
            const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
            const dataFeedDetailsExceedingMaximumLength = ethers.utils.defaultAbiCoder.encode(
              ['address[]', 'bytes32[]'],
              [
                Array(MAXIMUM_BEACON_COUNT_IN_SET + 1).fill(ethers.constants.AddressZero),
                Array(MAXIMUM_BEACON_COUNT_IN_SET + 1).fill(ethers.constants.HashZero),
              ]
            );
            await expect(
              airseekerRegistry.connect(roles.randomPerson).registerDataFeed(dataFeedDetailsExceedingMaximumLength)
            ).to.be.revertedWith('Feed details data too long');
          });
        }
      );
    });
    context(
      'Data feed details neither long enough to specify a single Beacon or at least long enough to specify a Beacon set composed of two Beacons',
      function () {
        it('reverts', async function () {
          const { roles, airseekerRegistry } = await helpers.loadFixture(deploy);
          await expect(airseekerRegistry.connect(roles.randomPerson).registerDataFeed('0x')).to.be.revertedWith(
            'Details data too short'
          );
          const templateId = deriveTemplateId(`OIS title of Airnode with address ${roles.airnode1.address}`, 'ETH/USD');
          const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes32'],
            [roles.airnode1.address, templateId]
          );
          await expect(
            airseekerRegistry.connect(roles.randomPerson).registerDataFeed(`${dataFeedDetails}00`)
          ).to.be.revertedWith('Details data too short');
        });
      }
    );
  });

  describe('activeDataFeed', function () {
    context('The index belongs to an active data feed ID', function () {
      context('Data feed ID update parameters have been set', function () {
        context('Data feed details have been set', function () {
          context('Data feed is a Beacon set', function () {
            it('returns data feed ID, details, reading, update parameters and respective signed API URLs', async function () {
              const { roles, airnodes, api3ServerV1, dataFeedId, airseekerRegistry, signedApiUrls } =
                await helpers.loadFixture(deploy);
              await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              await airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters);
              const dataFeedDetails = await registerBeaconSet(airseekerRegistry, 'ETH/USD', airnodes);
              const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
              expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
              expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal(updateParameters);
              expect(activeDataFeed.signedApiUrls).to.deep.equal(signedApiUrls);
            });
          });
          context('Data feed is a Beacon', function () {
            it('returns data feed ID, details, reading, update parameters and the respective signed API URL', async function () {
              const { roles, api3ServerV1, airseekerRegistry, signedApiUrls } = await helpers.loadFixture(deploy);
              const templateId = deriveTemplateId(
                `OIS title of Airnode with address ${roles.airnode1.address}`,
                'ETH/USD'
              );
              const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
              const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                ['address', 'bytes32'],
                [roles.airnode1.address, templateId]
              );
              await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(beaconId);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              await airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(beaconId, updateParameters);
              await airseekerRegistry.registerDataFeed(dataFeedDetails);
              const dataFeedReading = await api3ServerV1.dataFeeds(beaconId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(beaconId);
              expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
              expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal(updateParameters);
              expect(activeDataFeed.signedApiUrls).to.deep.equal([signedApiUrls[0]]);
            });
          });
        });
        context('Data feed details have not been set', function () {
          it('returns data feed ID, reading and update parameters', async function () {
            const { roles, api3ServerV1, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
            const updateParameters = ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'int224', 'uint256'],
              [1000000, 0, 24 * 60 * 60]
            );
            await airseekerRegistry.connect(roles.owner).setDataFeedIdUpdateParameters(dataFeedId, updateParameters);
            const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
            const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
            expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
            expect(activeDataFeed.dataFeedDetails).to.equal('0x');
            expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
            expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
            expect(activeDataFeed.updateParameters).to.equal(updateParameters);
            expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
          });
        });
      });
      context('Data feed ID update parameters have not been set', function () {
        context('Data feed details have been set', function () {
          context('Data feed is a Beacon set', function () {
            it('returns data feed ID, details, reading, and respective signed API URLs', async function () {
              const { roles, airnodes, api3ServerV1, dataFeedId, airseekerRegistry, signedApiUrls } =
                await helpers.loadFixture(deploy);
              await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
              const dataFeedDetails = await registerBeaconSet(airseekerRegistry, 'ETH/USD', airnodes);
              const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
              expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
              expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal('0x');
              expect(activeDataFeed.signedApiUrls).to.deep.equal(signedApiUrls);
            });
          });
          context('Data feed is a Beacon', function () {
            it('returns data feed ID, details, reading and the respective signed API URL', async function () {
              const { roles, api3ServerV1, airseekerRegistry, signedApiUrls } = await helpers.loadFixture(deploy);
              const templateId = deriveTemplateId(
                `OIS title of Airnode with address ${roles.airnode1.address}`,
                'ETH/USD'
              );
              const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
              const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                ['address', 'bytes32'],
                [roles.airnode1.address, templateId]
              );
              await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(beaconId);
              await airseekerRegistry.registerDataFeed(dataFeedDetails);
              const dataFeedReading = await api3ServerV1.dataFeeds(beaconId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(beaconId);
              expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
              expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal('0x');
              expect(activeDataFeed.signedApiUrls).to.deep.equal([signedApiUrls[0]]);
            });
          });
        });
        context('Data feed details have not been set', function () {
          it('returns data feed ID and reading', async function () {
            const { roles, api3ServerV1, dataFeedId, airseekerRegistry } = await helpers.loadFixture(deploy);
            await airseekerRegistry.connect(roles.owner).setDataFeedIdToBeActivated(dataFeedId);
            const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
            const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
            expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
            expect(activeDataFeed.dataFeedDetails).to.equal('0x');
            expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
            expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
            expect(activeDataFeed.updateParameters).to.equal('0x');
            expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
          });
        });
      });
    });
    context('The index belongs to an active dAPI name', function () {
      context('dAPI name has been set at Api3ServerV1', function () {
        context('dAPI name update parameters have been set', function () {
          context('Data feed details have been set', function () {
            context('Data feed is a Beacon set', function () {
              it('returns data feed ID, dAPI name, details, reading, update parameters and respective signed API URLs', async function () {
                const { roles, airnodes, api3ServerV1, dataFeedId, dapiName, airseekerRegistry, signedApiUrls } =
                  await helpers.loadFixture(deploy);
                await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
                const updateParameters = ethers.utils.defaultAbiCoder.encode(
                  ['uint256', 'int224', 'uint256'],
                  [1000000, 0, 24 * 60 * 60]
                );
                await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
                const dataFeedDetails = await registerBeaconSet(airseekerRegistry, 'ETH/USD', airnodes);
                const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
                const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
                expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
                expect(activeDataFeed.dapiName).to.equal(dapiName);
                expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
                expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
                expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
                expect(activeDataFeed.updateParameters).to.equal(updateParameters);
                expect(activeDataFeed.signedApiUrls).to.deep.equal(signedApiUrls);
              });
            });
            context('Data feed is a Beacon', function () {
              it('returns data feed ID, dAPI name, details, reading, update parameters and the respective signed API URL', async function () {
                const { roles, api3ServerV1, dapiName, airseekerRegistry, signedApiUrls } = await helpers.loadFixture(
                  deploy
                );
                const templateId = deriveTemplateId(
                  `OIS title of Airnode with address ${roles.airnode1.address}`,
                  'ETH/USD'
                );
                const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
                const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                  ['address', 'bytes32'],
                  [roles.airnode1.address, templateId]
                );
                await api3ServerV1.connect(roles.api3ServerV1Manager).setDapiName(dapiName, beaconId);
                await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
                const updateParameters = ethers.utils.defaultAbiCoder.encode(
                  ['uint256', 'int224', 'uint256'],
                  [1000000, 0, 24 * 60 * 60]
                );
                await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
                await airseekerRegistry.connect(roles.owner).registerDataFeed(dataFeedDetails);
                const dataFeedReading = await api3ServerV1.dataFeeds(beaconId);
                const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
                expect(activeDataFeed.dataFeedId).to.equal(beaconId);
                expect(activeDataFeed.dapiName).to.equal(dapiName);
                expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
                expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
                expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
                expect(activeDataFeed.updateParameters).to.equal(updateParameters);
                expect(activeDataFeed.signedApiUrls).to.deep.equal([signedApiUrls[0]]);
              });
            });
          });
          context('Data feed details have not been set', function () {
            it('returns data feed ID, dAPI name, reading and update parameters', async function () {
              const { roles, api3ServerV1, dataFeedId, dapiName, airseekerRegistry } = await helpers.loadFixture(
                deploy
              );
              await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
              const updateParameters = ethers.utils.defaultAbiCoder.encode(
                ['uint256', 'int224', 'uint256'],
                [1000000, 0, 24 * 60 * 60]
              );
              await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
              const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
              expect(activeDataFeed.dapiName).to.equal(dapiName);
              expect(activeDataFeed.dataFeedDetails).to.equal('0x');
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal(updateParameters);
              expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
            });
          });
        });
        context('dAPI name update parameters have not been set', function () {
          context('Data feed details have been set', function () {
            context('Data feed is a Beacon set', function () {
              it('returns data feed ID, dAPI name, details, reading and respective signed API URLs', async function () {
                const { roles, airnodes, api3ServerV1, dataFeedId, dapiName, airseekerRegistry, signedApiUrls } =
                  await helpers.loadFixture(deploy);
                await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
                const dataFeedDetails = await registerBeaconSet(airseekerRegistry, 'ETH/USD', airnodes);
                const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
                const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
                expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
                expect(activeDataFeed.dapiName).to.equal(dapiName);
                expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
                expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
                expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
                expect(activeDataFeed.updateParameters).to.equal('0x');
                expect(activeDataFeed.signedApiUrls).to.deep.equal(signedApiUrls);
              });
            });
            context('Data feed is a Beacon', function () {
              it('returns data feed ID, dAPI name, details, reading and the respective signed API URL', async function () {
                const { roles, api3ServerV1, dataFeedId, dapiName, airseekerRegistry, signedApiUrls } =
                  await helpers.loadFixture(deploy);
                const templateId = deriveTemplateId(
                  `OIS title of Airnode with address ${roles.airnode1.address}`,
                  'ETH/USD'
                );
                const beaconId = deriveBeaconId(roles.airnode1.address, templateId);
                const dataFeedDetails = ethers.utils.defaultAbiCoder.encode(
                  ['address', 'bytes32'],
                  [roles.airnode1.address, templateId]
                );
                await api3ServerV1.connect(roles.api3ServerV1Manager).setDapiName(dapiName, beaconId);
                await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
                await airseekerRegistry.connect(roles.owner).registerDataFeed(dataFeedDetails);
                const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
                const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
                expect(activeDataFeed.dataFeedId).to.equal(beaconId);
                expect(activeDataFeed.dapiName).to.equal(dapiName);
                expect(activeDataFeed.dataFeedDetails).to.equal(dataFeedDetails);
                expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
                expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
                expect(activeDataFeed.updateParameters).to.equal('0x');
                expect(activeDataFeed.signedApiUrls).to.deep.equal([signedApiUrls[0]]);
              });
            });
          });
          context('Data feed details have not been set', function () {
            it('returns data feed ID, dAPI name, details, reading and respective signed API URLs', async function () {
              const { roles, api3ServerV1, dataFeedId, dapiName, airseekerRegistry } = await helpers.loadFixture(
                deploy
              );
              await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
              const dataFeedReading = await api3ServerV1.dataFeeds(dataFeedId);
              const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
              expect(activeDataFeed.dataFeedId).to.equal(dataFeedId);
              expect(activeDataFeed.dapiName).to.equal(dapiName);
              expect(activeDataFeed.dataFeedDetails).to.equal('0x');
              expect(activeDataFeed.dataFeedValue).to.equal(dataFeedReading.value);
              expect(activeDataFeed.dataFeedTimestamp).to.equal(dataFeedReading.timestamp);
              expect(activeDataFeed.updateParameters).to.equal('0x');
              expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
            });
          });
        });
      });
      context('dAPI name has not been set at Api3ServerV1', function () {
        context('dAPI name update parameters have been set', function () {
          it('returns dAPI name and update parameters', async function () {
            const { roles, api3ServerV1, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            await api3ServerV1.connect(roles.api3ServerV1Manager).setDapiName(dapiName, ethers.constants.HashZero);
            await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
            const updateParameters = ethers.utils.defaultAbiCoder.encode(
              ['uint256', 'int224', 'uint256'],
              [1000000, 0, 24 * 60 * 60]
            );
            await airseekerRegistry.connect(roles.owner).setDapiNameUpdateParameters(dapiName, updateParameters);
            const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(activeDataFeed.dataFeedId).to.equal(ethers.constants.HashZero);
            expect(activeDataFeed.dapiName).to.equal(dapiName);
            expect(activeDataFeed.dataFeedDetails).to.equal('0x');
            expect(activeDataFeed.dataFeedValue).to.equal(0);
            expect(activeDataFeed.dataFeedTimestamp).to.equal(0);
            expect(activeDataFeed.updateParameters).to.equal(updateParameters);
            expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
          });
        });
        context('dAPI name update parameters have not been set', function () {
          it('returns dAPI name', async function () {
            const { roles, api3ServerV1, dapiName, airseekerRegistry } = await helpers.loadFixture(deploy);
            await api3ServerV1.connect(roles.api3ServerV1Manager).setDapiName(dapiName, ethers.constants.HashZero);
            await airseekerRegistry.connect(roles.owner).setDapiNameToBeActivated(dapiName);
            const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
            expect(activeDataFeed.dataFeedId).to.equal(ethers.constants.HashZero);
            expect(activeDataFeed.dapiName).to.equal(dapiName);
            expect(activeDataFeed.dataFeedDetails).to.equal('0x');
            expect(activeDataFeed.dataFeedValue).to.equal(0);
            expect(activeDataFeed.dataFeedTimestamp).to.equal(0);
            expect(activeDataFeed.updateParameters).to.equal('0x');
            expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
          });
        });
      });
    });
    context('The index does not belong to an active data feed ID or dAPI name', function () {
      it('returns nothing', async function () {
        const { airseekerRegistry } = await helpers.loadFixture(deploy);
        const activeDataFeed = await airseekerRegistry.activeDataFeed(0);
        expect(activeDataFeed.dataFeedId).to.equal(ethers.constants.HashZero);
        expect(activeDataFeed.dapiName).to.equal(ethers.constants.HashZero);
        expect(activeDataFeed.dataFeedDetails).to.equal('0x');
        expect(activeDataFeed.dataFeedValue).to.equal(0);
        expect(activeDataFeed.dataFeedTimestamp).to.equal(0);
        expect(activeDataFeed.updateParameters).to.equal('0x');
        expect(activeDataFeed.signedApiUrls).to.deep.equal([]);
      });
    });
  });
});

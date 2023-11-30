const hre = require('hardhat');
const helpers = require('@nomicfoundation/hardhat-network-helpers');
const { StandardMerkleTree } = require('@openzeppelin/merkle-tree');
const { expect } = require('chai');
const { generateRandomBytes32, generateRandomAddress } = require('./test-utils');

describe('HashRegistry', function () {
  const deploy = async () => {
    const roleNames = [
      'deployer',
      'owner',
      'dapiFallbackRootSigner1',
      'dapiFallbackRootSigner2',
      'dapiFallbackRootSigner3',
      'airnode',
      'randomPerson',
    ];
    const accounts = await hre.ethers.getSigners();
    const roles = roleNames.reduce((acc, roleName, index) => {
      return { ...acc, [roleName]: accounts[index] };
    }, {});

    const HashRegistry = await hre.ethers.getContractFactory('HashRegistry', roles.deployer);
    const hashRegistry = await HashRegistry.deploy(roles.owner.address);

    const dapiName = 'API3/USD';
    const fallbackBeaconTemplateId = generateRandomBytes32();
    const fallbackBeaconId = hre.ethers.utils.solidityKeccak256(
      ['address', 'bytes32'],
      [roles.airnode.address, fallbackBeaconTemplateId]
    );
    const fallbackSponsorWalletAddress = generateRandomAddress();

    const treeEntry = [hre.ethers.utils.formatBytes32String(dapiName), fallbackBeaconId, fallbackSponsorWalletAddress];
    const treeValues = [
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      treeEntry,
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
      [generateRandomBytes32(), generateRandomBytes32(), generateRandomAddress()],
    ];
    const tree = StandardMerkleTree.of(treeValues, ['bytes32', 'bytes32', 'address']);
    const root = tree.root;
    const timestamp = Math.floor(Date.now() / 1000);

    const dapiFallbackHashType = hre.ethers.utils.solidityKeccak256(['string'], ['dAPI fallback root']);
    const messages = hre.ethers.utils.arrayify(
      hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [dapiFallbackHashType, root, timestamp])
    );
    const signatures = await Promise.all(
      [roles.dapiFallbackRootSigner1, roles.dapiFallbackRootSigner2, roles.dapiFallbackRootSigner3].map(
        async (rootSigner) => await rootSigner.signMessage(messages)
      )
    );

    return {
      roles,
      hashRegistry,
      dapiName,
      fallbackBeaconTemplateId,
      fallbackBeaconId,
      fallbackSponsorWalletAddress,
      dapiFallbackHashType,
      root,
      timestamp,
      messages,
      signatures,
    };
  };

  describe('constructor', function () {
    it('constructs', async function () {
      const { roles, hashRegistry } = await helpers.loadFixture(deploy);
      expect(await hashRegistry.owner()).to.equal(roles.owner.address);
    });
  });

  describe('setUpSigners', function () {
    context('Signers is not emtpy', function () {
      context('Hash type signers is empty', function () {
        it('set up signers', async function () {
          const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
          expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
          const signers = [
            roles.dapiFallbackRootSigner1.address,
            roles.dapiFallbackRootSigner2.address,
            roles.dapiFallbackRootSigner3.address,
          ];
          await expect(hashRegistry.connect(roles.owner).setUpSigners(dapiFallbackHashType, signers))
            .to.emit(hashRegistry, 'SetUpSigners')
            .withArgs(dapiFallbackHashType, signers);
          expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal(signers);
        });
      });
      context('Signers already initialized', function () {
        it('reverts', async function () {
          const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
          expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
          await expect(
            hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
          )
            .to.emit(hashRegistry, 'AddedSigner')
            .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address, [
              roles.dapiFallbackRootSigner1.address,
            ]);
          await expect(
            hashRegistry
              .connect(roles.owner)
              .setUpSigners(dapiFallbackHashType, [
                roles.dapiFallbackRootSigner2.address,
                roles.dapiFallbackRootSigner3.address,
              ])
          ).to.be.revertedWith('Signers already initialized');
        });
      });
    });
    context('Signers is emtpy', function () {
      it('reverts', async function () {
        const { roles, hashRegistry } = await helpers.loadFixture(deploy);
        await expect(hashRegistry.connect(roles.owner).setUpSigners(generateRandomBytes32(), [])).to.be.revertedWith(
          'Signers empty'
        );
      });
    });
  });

  describe('addSigner', function () {
    context('Sender is the owner', function () {
      context('Hash type is not zero', function () {
        context('Signer is not zero', function () {
          context('Signer does not exist', function () {
            it('adds signer', async function () {
              const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
              expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
              await expect(
                hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
              )
                .to.emit(hashRegistry, 'AddedSigner')
                .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address, [
                  roles.dapiFallbackRootSigner1.address,
                ]);
              expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([
                roles.dapiFallbackRootSigner1.address,
              ]);
              await expect(
                hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner2.address)
              )
                .to.emit(hashRegistry, 'AddedSigner')
                .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner2.address, [
                  roles.dapiFallbackRootSigner1.address,
                  roles.dapiFallbackRootSigner2.address,
                ]);
              expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([
                roles.dapiFallbackRootSigner1.address,
                roles.dapiFallbackRootSigner2.address,
              ]);
            });
          });
          context('Signer exists', function () {
            it('reverts', async function () {
              const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
              expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
              await expect(
                hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
              )
                .to.emit(hashRegistry, 'AddedSigner')
                .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address, [
                  roles.dapiFallbackRootSigner1.address,
                ]);
              await expect(
                hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
              ).to.be.revertedWith('Duplicate signer address');
            });
          });
        });
        context('Signer address zero', function () {
          it('reverts', async function () {
            const { roles, hashRegistry } = await helpers.loadFixture(deploy);
            await expect(
              hashRegistry.connect(roles.owner).addSigner(generateRandomBytes32(), hre.ethers.constants.AddressZero)
            ).to.be.revertedWith('Signer address zero');
          });
        });
      });
      context('Hash type zero', function () {
        it('reverts', async function () {
          const { roles, hashRegistry } = await helpers.loadFixture(deploy);
          await expect(
            hashRegistry
              .connect(roles.owner)
              .addSigner(hre.ethers.constants.HashZero, roles.dapiFallbackRootSigner1.address)
          ).to.be.revertedWith('Hash type zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, hashRegistry } = await helpers.loadFixture(deploy);
        await expect(
          hashRegistry.connect(roles.randomPerson).addSigner(generateRandomBytes32(), generateRandomAddress())
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('removeSigner', function () {
    context('Sender is the owner', function () {
      context('Signer exists', function () {
        it('removes signer', async function () {
          const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
          const signers = [roles.dapiFallbackRootSigner1, roles.dapiFallbackRootSigner2, roles.dapiFallbackRootSigner3];
          expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
          const expectedSigners = [];
          for (const signer of signers) {
            expectedSigners.push(signer.address);
            await expect(hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, signer.address))
              .to.emit(hashRegistry, 'AddedSigner')
              .withArgs(dapiFallbackHashType, signer.address, expectedSigners);
          }
          // remove from the middle
          await expect(
            hashRegistry.connect(roles.owner).removeSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner2.address)
          )
            .to.emit(hashRegistry, 'RemovedSigner')
            .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner2.address, [
              roles.dapiFallbackRootSigner1.address,
              roles.dapiFallbackRootSigner3.address,
            ]);

          // remove at the end
          await expect(
            hashRegistry.connect(roles.owner).removeSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner3.address)
          )
            .to.emit(hashRegistry, 'RemovedSigner')
            .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner3.address, [
              roles.dapiFallbackRootSigner1.address,
            ]);
          // remove remaining signer
          await expect(
            hashRegistry.connect(roles.owner).removeSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
          )
            .to.emit(hashRegistry, 'RemovedSigner')
            .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address, []);
        });
      });
      context('Signer does not exist', function () {
        it('reverts', async function () {
          const { roles, hashRegistry, dapiFallbackHashType } = await helpers.loadFixture(deploy);
          expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal([]);
          await expect(
            hashRegistry.connect(roles.owner).removeSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
          ).to.be.revertedWith('Signer does not exist');
          await expect(
            hashRegistry.connect(roles.owner).addSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address)
          )
            .to.emit(hashRegistry, 'AddedSigner')
            .withArgs(dapiFallbackHashType, roles.dapiFallbackRootSigner1.address, [
              roles.dapiFallbackRootSigner1.address,
            ]);
          await expect(
            hashRegistry.connect(roles.owner).removeSigner(dapiFallbackHashType, roles.dapiFallbackRootSigner2.address)
          ).to.be.revertedWith('Signer does not exist');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { roles, hashRegistry } = await helpers.loadFixture(deploy);
        await expect(
          hashRegistry.connect(roles.randomPerson).removeSigner(generateRandomBytes32(), generateRandomAddress())
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('registerHash', function () {
    context('Signers is not empty', function () {
      context('Number of signatures is equal to number of signers', function () {
        context('All signatures match', function () {
          context('Timestamp is newer', function () {
            it('registers hash', async function () {
              const { roles, hashRegistry, dapiFallbackHashType, root, timestamp, signatures } =
                await helpers.loadFixture(deploy);
              const signers = [
                roles.dapiFallbackRootSigner1.address,
                roles.dapiFallbackRootSigner2.address,
                roles.dapiFallbackRootSigner3.address,
              ];
              expect(await hashRegistry.hashTypeToHash(dapiFallbackHashType)).to.equal(hre.ethers.constants.HashZero);
              expect(await hashRegistry.hashTypeToTimestamp(dapiFallbackHashType)).to.equal(0);
              await hashRegistry
                .connect(roles.owner)
                .multicall(
                  signers.map((signer) =>
                    hashRegistry.interface.encodeFunctionData('addSigner', [dapiFallbackHashType, signer])
                  )
                );
              await expect(hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, signatures))
                .to.emit(hashRegistry, 'RegisteredHash')
                .withArgs(dapiFallbackHashType, root, timestamp);
              expect(await hashRegistry.hashTypeToHash(dapiFallbackHashType)).to.equal(root);
              expect(await hashRegistry.hashTypeToTimestamp(dapiFallbackHashType)).to.equal(timestamp);
            });
          });
          context('Timestamp not larger', function () {
            it('reverts', async function () {
              const { roles, hashRegistry, dapiFallbackHashType, root, timestamp, signatures } =
                await helpers.loadFixture(deploy);
              const signers = [
                roles.dapiFallbackRootSigner1.address,
                roles.dapiFallbackRootSigner2.address,
                roles.dapiFallbackRootSigner3.address,
              ];
              await hashRegistry
                .connect(roles.owner)
                .multicall(
                  signers.map((signer) =>
                    hashRegistry.interface.encodeFunctionData('addSigner', [dapiFallbackHashType, signer])
                  )
                );
              expect(await hashRegistry.getSigners(dapiFallbackHashType)).to.deep.equal(signers);
              await expect(hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, signatures))
                .to.emit(hashRegistry, 'RegisteredHash')
                .withArgs(dapiFallbackHashType, root, timestamp);
              await expect(
                hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, signatures)
              ).to.be.revertedWith('Timestamp not larger');
            });
          });
        });
        context('All signatures do not match', function () {
          it('reverts', async function () {
            const { roles, hashRegistry, dapiFallbackHashType, root, timestamp, signatures, messages } =
              await helpers.loadFixture(deploy);
            const signers = [
              roles.dapiFallbackRootSigner1.address,
              roles.dapiFallbackRootSigner2.address,
              roles.dapiFallbackRootSigner3.address,
            ];
            await hashRegistry
              .connect(roles.owner)
              .multicall(
                signers.map((signer) =>
                  hashRegistry.interface.encodeFunctionData('addSigner', [dapiFallbackHashType, signer])
                )
              );
            // Signed by a different signer
            await expect(
              hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, [
                await roles.randomPerson.signMessage(messages),
                ...signatures.slice(1),
              ])
            ).to.be.revertedWith('Signature mismatch');
            // Signed a different root
            const wrongRootMessages = hre.ethers.utils.arrayify(
              hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32', 'uint256'],
                [dapiFallbackHashType, generateRandomBytes32(), timestamp]
              )
            );
            await expect(
              hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, [
                await roles.dapiFallbackRootSigner1.signMessage(wrongRootMessages),
                ...signatures.slice(1),
              ])
            ).to.be.revertedWith('Signature mismatch');
            // All signatures are different
            await expect(
              hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, Array(3).fill(signatures[0]))
            ).to.be.revertedWith('Signature mismatch');
            // All signatures are in the expected order
            await expect(
              hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, signatures.reverse())
            ).to.be.revertedWith('Signature mismatch');
          });
        });
      });
      context('Number of signatures is not equal to number of signers', function () {
        it('reverts', async function () {
          const { roles, hashRegistry, dapiFallbackHashType, root, timestamp, signatures } = await helpers.loadFixture(
            deploy
          );
          const signers = [
            roles.dapiFallbackRootSigner1.address,
            roles.dapiFallbackRootSigner2.address,
            roles.dapiFallbackRootSigner3.address,
          ];
          await hashRegistry
            .connect(roles.owner)
            .multicall(
              signers.map((signer) =>
                hashRegistry.interface.encodeFunctionData('addSigner', [dapiFallbackHashType, signer])
              )
            );
          await expect(
            hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, signatures.slice(1))
          ).to.be.revertedWith('Invalid number of signatures');
        });
      });
    });
    context('Signers empty', function () {
      it('reverts', async function () {
        const { hashRegistry, dapiFallbackHashType, root, timestamp } = await helpers.loadFixture(deploy);
        await expect(hashRegistry.registerHash(dapiFallbackHashType, root, timestamp, [])).to.be.revertedWith(
          'Signers not initialized'
        );
      });
    });
  });
});

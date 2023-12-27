const { ethers } = require('hardhat');
const { expect } = require('chai');
const helpers = require('@nomicfoundation/hardhat-network-helpers');

describe('HashRegistryV2', function () {
  function signHash(signers, hashType, hash, timestamp) {
    return signers.map((signer) =>
      signer.signMessage(
        ethers.utils.arrayify(
          ethers.utils.solidityKeccak256(['bytes32', 'bytes32', 'uint256'], [hashType, hash, timestamp])
        )
      )
    );
  }

  async function deploy() {
    const hashTypeA = ethers.utils.solidityKeccak256(['string'], ['Hash type A']);
    const hashTypeB = ethers.utils.solidityKeccak256(['string'], ['Hash type B']);

    const roleNames = [
      'deployer',
      'owner',
      'hashTypeASigner1',
      'hashTypeASigner2',
      'hashTypeASigner3',
      'hashTypeBSigner1',
      'hashTypeBSigner2',
      'randomPerson',
    ];
    const accounts = await ethers.getSigners();
    const roles = roleNames.reduce((acc, roleName, index) => {
      return { ...acc, [roleName]: accounts[index] };
    }, {});
    function extractAndSortRoles(roles, namePrefix) {
      return Object.keys(roles)
        .reduce((acc, roleName) => {
          if (roleName.startsWith(namePrefix)) {
            return [...acc, roles[roleName]];
          }
          return acc;
        }, [])
        .sort((a, b) => ethers.BigNumber.from(a.address).sub(ethers.BigNumber.from(b.address)));
    }
    const sortedHashTypeASigners = extractAndSortRoles(roles, 'hashTypeASigner');
    const sortedHashTypeBSigners = extractAndSortRoles(roles, 'hashTypeBSigner');

    const HashRegistryV2 = await ethers.getContractFactory('HashRegistryV2', roles.deployer);
    const hashRegistryV2 = await HashRegistryV2.deploy(roles.owner.address);

    return {
      hashTypeA,
      hashTypeB,
      roles,
      sortedHashTypeASigners,
      sortedHashTypeBSigners,
      hashRegistryV2,
    };
  }

  async function deployAndSetSigners() {
    const { hashTypeA, hashTypeB, roles, sortedHashTypeASigners, sortedHashTypeBSigners, hashRegistryV2 } =
      await deploy();

    await hashRegistryV2.connect(roles.owner).setSigners(
      hashTypeA,
      sortedHashTypeASigners.map((signer) => signer.address)
    );
    await hashRegistryV2.connect(roles.owner).setSigners(
      hashTypeB,
      sortedHashTypeBSigners.map((signer) => signer.address)
    );
    return {
      hashTypeA,
      hashTypeB,
      roles,
      sortedHashTypeASigners,
      sortedHashTypeBSigners,
      hashRegistryV2,
    };
  }

  describe('constructor', function () {
    it('constructs', async function () {
      const { roles, hashRegistryV2 } = await helpers.loadFixture(deploy);
      expect(await hashRegistryV2.owner()).to.equal(roles.owner.address);
    });
  });

  describe('setSigners', function () {
    context('Sender is the owner', function () {
      context('Hash type is not zero', function () {
        context('Signers are not empty', function () {
          context('First signer address is not zero', function () {
            context('Signer addresses are in ascending order', function () {
              it('sets signers', async function () {
                const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
                expect(await hashRegistryV2.hashTypeToSignersHash(hashTypeA)).to.equal(ethers.constants.HashZero);
                await expect(
                  hashRegistryV2.connect(roles.owner).setSigners(
                    hashTypeA,
                    sortedHashTypeASigners.map((signer) => signer.address)
                  )
                )
                  .to.emit(hashRegistryV2, 'SetSigners')
                  .withArgs(
                    hashTypeA,
                    sortedHashTypeASigners.map((signer) => signer.address)
                  );
                expect(await hashRegistryV2.hashTypeToSignersHash(hashTypeA)).to.equal(
                  ethers.utils.solidityKeccak256(
                    ['address[]'],
                    [sortedHashTypeASigners.map((signer) => signer.address)]
                  )
                );
              });
            });
            context('Signer addresses are not in ascending order', function () {
              it('reverts', async function () {
                const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
                const unsortedHashTypeASigners = [...sortedHashTypeASigners.slice(1), sortedHashTypeASigners[0]];
                await expect(
                  hashRegistryV2.connect(roles.owner).setSigners(
                    hashTypeA,
                    unsortedHashTypeASigners.map((signer) => signer.address)
                  )
                ).to.be.revertedWith('Signers not in ascending order');
                const duplicatedHashTypeASigners = [sortedHashTypeASigners[1], ...sortedHashTypeASigners.slice(1)];
                await expect(
                  hashRegistryV2.connect(roles.owner).setSigners(
                    hashTypeA,
                    duplicatedHashTypeASigners.map((signer) => signer.address)
                  )
                ).to.be.revertedWith('Signers not in ascending order');
              });
            });
          });
          context('First signer address is zero', function () {
            it('reverts', async function () {
              const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
              const hashTypeASignersStartingWithZeroAddress = [
                { address: ethers.constants.AddressZero },
                ...sortedHashTypeASigners.slice(1),
              ];
              await expect(
                hashRegistryV2.connect(roles.owner).setSigners(
                  hashTypeA,
                  hashTypeASignersStartingWithZeroAddress.map((signer) => signer.address)
                )
              ).to.be.revertedWith('First signer address zero');
            });
          });
        });
        context('Signers are empty', function () {
          it('reverts', async function () {
            const { hashTypeA, roles, hashRegistryV2 } = await helpers.loadFixture(deploy);
            await expect(hashRegistryV2.connect(roles.owner).setSigners(hashTypeA, [])).to.be.revertedWith(
              'Signers empty'
            );
          });
        });
      });
      context('Hash type is zero', function () {
        it('reverts', async function () {
          const { roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
          await expect(
            hashRegistryV2.connect(roles.owner).setSigners(
              ethers.constants.HashZero,
              sortedHashTypeASigners.map((signer) => signer.address)
            )
          ).to.be.revertedWith('Hash type zero');
        });
      });
    });
    context('Sender is not the owner', function () {
      it('reverts', async function () {
        const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
        await expect(
          hashRegistryV2.connect(roles.randomPerson).setSigners(
            hashTypeA,
            sortedHashTypeASigners.map((signer) => signer.address)
          )
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });
  });

  describe('registerHash', function () {
    context('Timestamp is not from the future', function () {
      context('Timestamp is more recent than the previous one', function () {
        context('Signers are set for the hash type', function () {
          context('All signatures match', function () {
            it('registers hash', async function () {
              const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(
                deployAndSetSigners
              );
              const hash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
              const timestamp = await helpers.time.latest();
              const signatures = await signHash(sortedHashTypeASigners, hashTypeA, hash, timestamp);
              const hashBefore = await hashRegistryV2.hashes(hashTypeA);
              expect(hashBefore.value).to.equal(ethers.constants.HashZero);
              expect(hashBefore.timestamp).to.equal(ethers.constants.Zero);
              expect(await hashRegistryV2.getHashValue(hashTypeA)).to.equal(ethers.constants.HashZero);
              await expect(
                hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures)
              )
                .to.emit(hashRegistryV2, 'RegisteredHash')
                .withArgs(hashTypeA, hash, timestamp);
              const hashAfter = await hashRegistryV2.hashes(hashTypeA);
              expect(hashAfter.value).to.equal(hash);
              expect(hashAfter.timestamp).to.equal(timestamp);
              expect(await hashRegistryV2.getHashValue(hashTypeA)).to.equal(hash);
            });
          });
          context('Not all signatures match', function () {
            it('reverts', async function () {
              const { hashTypeA, roles, sortedHashTypeBSigners, hashRegistryV2 } = await helpers.loadFixture(
                deployAndSetSigners
              );
              const hash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
              const timestamp = await helpers.time.latest();
              // Sign with the wrong signers
              const signatures = await signHash(sortedHashTypeBSigners, hashTypeA, hash, timestamp);
              await expect(
                hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures)
              ).to.be.revertedWith('Signature mismatch');
            });
          });
        });
        context('Signers are not set for the hash type', function () {
          it('reverts', async function () {
            const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(deploy);
            const hash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
            const timestamp = await helpers.time.latest();
            const signatures = await signHash(sortedHashTypeASigners, hashTypeA, hash, timestamp);
            await expect(
              hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures)
            ).to.be.revertedWith('Signers not set');
          });
        });
      });
      context('Timestamp is not more recent than the previous one', function () {
        it('reverts', async function () {
          const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(
            deployAndSetSigners
          );
          const hash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
          const timestamp = await helpers.time.latest();
          const signatures = await signHash(sortedHashTypeASigners, hashTypeA, hash, timestamp);
          await hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures);
          await expect(
            hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures)
          ).to.be.revertedWith('Timestamp not more recent');
        });
      });
    });
    context('Timestamp is from the future', function () {
      it('reverts', async function () {
        const { hashTypeA, roles, sortedHashTypeASigners, hashRegistryV2 } = await helpers.loadFixture(
          deployAndSetSigners
        );
        const hash = ethers.utils.hexlify(ethers.utils.randomBytes(32));
        const timestamp = (await helpers.time.latest()) + 3600;
        const signatures = await signHash(sortedHashTypeASigners, hashTypeA, hash, timestamp);
        await expect(
          hashRegistryV2.connect(roles.randomPerson).registerHash(hashTypeA, hash, timestamp, signatures)
        ).to.be.revertedWith('Timestamp from future');
      });
    });
  });
});

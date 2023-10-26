import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import nodaryUtilities from '@nodary/utilities';

// See https://github.com/nodaryio/utilities/issues/14
const ONE_PERCENT_NORMALIZED = 1 * 1e6;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

export default function getNodaryFallbackTree() {
  return StandardMerkleTree.of(
    nodaryUtilities.nodaryFeeds.map((nodaryFeed) => {
      return [
        ethers.utils.formatBytes32String(nodaryFeed.name),
        nodaryUtilities.computeFeedId(nodaryFeed.name),
        nodaryUtilities.computeSponsorWalletAddress(nodaryFeed.name, ONE_PERCENT_NORMALIZED, 0, ONE_DAY_IN_SECONDS),
      ];
    }),
    ['bytes32', 'bytes32', 'address']
  );
}

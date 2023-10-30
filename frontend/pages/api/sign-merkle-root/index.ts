// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { join } from 'path';
import { ethers } from 'ethers';
import { format, Options } from 'prettier';
import { validateTreeRootSignatures } from '../../../src/utils/validators';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// TODO: move types to a common place for frontend re-use
enum MerkleTrees {
  DAPI_FALLBACK = 'DAPI_FALLBACK',
}

export interface CurrentHash {
  timestamp: number;
  hash: string;
  signatures: string[];
  merkleTreeValues: {
    values: string[][];
  };
}

export interface SignMerkleRootRequest {
  signature: string;
  address: string;
  tree: MerkleTrees;
}

export interface WalletBallance {
  value: number;
  unit: string;
}

export interface RootSignatureMetadata {
  hashSigners: string[];
}

const merkleTreeConfig = {
  [MerkleTrees.DAPI_FALLBACK]: {
    fallbackTreeValidator: validateTreeRootSignatures,
    subfolder: 'dapi-fallback-merkle-tree-root',
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload: SignMerkleRootRequest = req.body;
  const { signature, address, tree } = payload;
  const treeConfig = merkleTreeConfig[tree];

  // Read current signatures from the file
  const currentHashPath = join(process.cwd(), '..', 'data', treeConfig.subfolder, 'current-hash.json');
  if (!existsSync(currentHashPath)) {
    return res.status(404).send('Current hash file not found');
  }
  const currentHash: CurrentHash = JSON.parse(readFileSync(currentHashPath, 'utf8'));

  // Read metadata to get the root signers
  const hashSignersPath = join(process.cwd(), '..', 'data', treeConfig.subfolder, 'hash-signers.json');
  if (!existsSync(hashSignersPath)) {
    return res.status(404).send('Hash signers file not found');
  }
  const hashSigners: RootSignatureMetadata = JSON.parse(readFileSync(hashSignersPath, 'utf8'));

  if (hashSigners.hashSigners.indexOf(address) === -1) {
    return res.status(404).send(`Address not part of hash signers for tree ${tree}`);
  }

  const merkleTree = StandardMerkleTree.of(currentHash.merkleTreeValues.values, ['bytes32', 'bytes32', 'address']);
  const root = ethers.utils.arrayify(merkleTree.root);

  // Set a new signature on the index belonging to the signing address
  currentHash.signatures[hashSigners.hashSigners.indexOf(address)] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = treeConfig.fallbackTreeValidator(
    root,
    currentHash.signatures,
    hashSigners.hashSigners
  );

  const validatedCurrentHash = { ...currentHash, signatures: validatedRootSignatures };

  // Write updated signatures to the file
  writeJsonFile(currentHashPath, validatedCurrentHash);

  return res.status(200).send('Successfully signed root');
}

export const PRETTIER_CONFIG: Options = {
  bracketSpacing: true,
  printWidth: 120,
  singleQuote: true,
  trailingComma: 'es5',
  useTabs: false,
};

interface JSONObject {
  [x: string]: JSONValue;
}

type JSONValue = string | number | boolean | JSONObject | string[] | string[][];

export const prettyJson = (payload: JSONValue) =>
  format(JSON.stringify(payload), { semi: false, parser: 'json', ...PRETTIER_CONFIG });

export const writeJsonFile = (path: string, payload: JSONValue) => {
  writeFileSync(path, prettyJson(payload));
};

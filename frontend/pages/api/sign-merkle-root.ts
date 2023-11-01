import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { join } from 'path';
import { ethers } from 'ethers';
import { validateTreeRootSignatures } from '../../lib/merkle-tree-utils';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { z } from 'zod';
import { exec } from 'child_process';

const MerkleTrees = z
  .literal('dapi-fallback')
  .or(z.literal('dapi-management').or(z.literal('dapi-priciing').or(z.literal('siged-api-url'))));

type TreeType = z.infer<typeof MerkleTrees>;

const requestBodySchema = z.object({
  signature: z.string(),
  address: z.string(),
  tree: MerkleTrees,
});

interface MerkleTreeData {
  signatures: Record<string, string>;
  merkleTreeValues: {
    values: string[][];
  };
}

interface SignMerkleRootRequest {
  signature: string;
  address: string;
  tree: TreeType;
}

interface RootSignatureMetadata {
  hashSigners: string[];
}

function getSubfolder(type: TreeType) {
  switch (type) {
    case 'dapi-fallback':
      return 'dapi-fallback-merkle-tree-root';
    default:
      return '';
  }
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const parseResult = requestBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).send(`Invalid body:\n, ${JSON.stringify(parseResult.error.format())}`);
  }

  const payload: SignMerkleRootRequest = req.body;
  const { signature, address, tree } = payload;

  const subfolder = getSubfolder(tree);

  // Read current signatures from the file
  const currentHashPath = join(process.cwd(), '..', 'data', subfolder, 'current-hash.json');
  if (!existsSync(currentHashPath)) {
    return res.status(404).send('Current hash file not found');
  }
  const currentHash: MerkleTreeData = JSON.parse(readFileSync(currentHashPath, 'utf8'));

  // Read metadata to get the root signers
  const hashSignersPath = join(process.cwd(), '..', 'data', subfolder, 'hash-signers.json');
  if (!existsSync(hashSignersPath)) {
    return res.status(404).send('Hash signers file not found');
  }
  const hashSigners: RootSignatureMetadata = JSON.parse(readFileSync(hashSignersPath, 'utf8'));

  if (!hashSigners.hashSigners.includes(address)) {
    return res.status(403).send(`Address not part of hash signers for tree ${tree}`);
  }

  const merkleTree = StandardMerkleTree.of(currentHash.merkleTreeValues.values, ['bytes32', 'bytes32', 'address']);
  const root = ethers.utils.arrayify(merkleTree.root);

  // Set a new signature on the index belonging to the signing address
  currentHash.signatures[hashSigners.hashSigners.indexOf(address)] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = validateTreeRootSignatures(root, currentHash.signatures, hashSigners.hashSigners);

  const validatedCurrentHash = { ...currentHash, signatures: validatedRootSignatures };

  // Write updated signatures to the file
  writeJsonFile(currentHashPath, validatedCurrentHash);

  exec('yarn prettier');

  return res.status(200).send('Successfully signed root');
}

interface JSONObject {
  [x: string]: JSONValue;
}

type JSONValue = string | number | boolean | JSONObject | string[] | string[][];

export const writeJsonFile = (path: string, payload: JSONValue) => {
  writeFileSync(path, JSON.stringify(payload));
};

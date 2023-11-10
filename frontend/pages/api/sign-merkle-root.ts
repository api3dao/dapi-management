import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import {
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createDapiFallbackMerkleTree,
  createSignedApiUrlMerkleTree,
  validateTreeRootSignatures,
} from '~/lib/merkle-tree-utils';
import { readSignerDataFrom, readTreeDataFrom, writeMerkleTreeData, type TreeSubFolder } from '~/lib/server/file-utils';
import { z } from 'zod';
import { exec } from 'child_process';

const treeTypeSchema = z
  .literal('dapi-fallback')
  .or(z.literal('dapi-management').or(z.literal('dapi-pricing').or(z.literal('signed-api-url'))));

type TreeType = z.infer<typeof treeTypeSchema>;

const requestBodySchema = z.object({
  signature: z.string(),
  address: z.string(),
  tree: treeTypeSchema,
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const parseResult = requestBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json(parseResult.error.format());
  }

  const { signature, address, tree } = parseResult.data;

  const [subfolder, createMerkleTree] = getTreeConfig(tree);
  const { path: currentHashPath, data: currentHash } = readTreeDataFrom({ subfolder, file: 'current-hash.json' });
  const { data: hashSigners } = readSignerDataFrom(subfolder);

  if (!hashSigners.includes(address)) {
    return res.status(403).send(`Address not part of hash signers for tree ${tree}`);
  }

  const merkleTree = createMerkleTree(currentHash.merkleTreeValues.values);
  const root = ethers.utils.arrayify(merkleTree.root);

  // Set a new signature belonging to the signing address
  currentHash.signatures[address] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = validateTreeRootSignatures(root, currentHash.signatures, hashSigners);

  const validatedCurrentHash = { ...currentHash, hash: merkleTree.root, signatures: validatedRootSignatures };

  // Write updated signatures to the file
  writeMerkleTreeData(currentHashPath, validatedCurrentHash);

  exec('yarn prettier');

  return res.status(200).send('Successfully signed root');
}

type MerkleTreeCreator = (values: string[][]) => StandardMerkleTree<string[]>;

function getTreeConfig(type: TreeType): [TreeSubFolder, MerkleTreeCreator] {
  switch (type) {
    case 'dapi-fallback':
      return ['dapi-fallback-merkle-tree-root', createDapiFallbackMerkleTree];
    case 'dapi-management':
      return ['dapi-management-merkle-tree-root', createDapiManagementMerkleTree];
    case 'dapi-pricing':
      return ['dapi-pricing-merkle-tree-root', createDapiPricingMerkleTree];
    case 'signed-api-url':
      return ['signed-api-url-merkle-tree-root', createSignedApiUrlMerkleTree];
  }
}

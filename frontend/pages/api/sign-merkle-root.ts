import type { NextApiRequest, NextApiResponse } from 'next';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import {
  DAPI_FALLBACK_MERKLE_TREE_TYPE,
  DAPI_MANAGEMENT_MERKLE_TREE_TYPE,
  DAPI_PRICING_MERKLE_TREE_TYPE,
  SIGNED_API_URL_MERKLE_TREE_TYPE,
  createDapiManagementMerkleTree,
  createDapiPricingMerkleTree,
  createDapiFallbackMerkleTree,
  createSignedApiUrlMerkleTree,
  validateTreeRootSignatures,
} from '~/lib/merkle-tree-utils';
import {
  readSignerDataFrom,
  readTreeDataFrom,
  writeMerkleTreeData,
  execute,
  type TreeSubFolder,
} from '~/lib/server/file-utils';
import { z } from 'zod';

const treeTypeSchema = z.union([
  z.literal(DAPI_FALLBACK_MERKLE_TREE_TYPE),
  z.literal(DAPI_MANAGEMENT_MERKLE_TREE_TYPE),
  z.literal(DAPI_PRICING_MERKLE_TREE_TYPE),
  z.literal(SIGNED_API_URL_MERKLE_TREE_TYPE),
]);

type TreeType = z.infer<typeof treeTypeSchema>;

const requestBodySchema = z.object({
  signature: z.string(),
  address: z.string(),
  treeType: treeTypeSchema,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const body = JSON.parse(req.body);

  const parseResult = requestBodySchema.safeParse(body);
  if (!parseResult.success) {
    return res.status(400).json(parseResult.error.format());
  }

  const { signature, address, treeType } = parseResult.data;

  const [subfolder, createMerkleTree] = getTreeConfig(treeType);
  const { path: currentHashPath, data: currentHash } = readTreeDataFrom({ subfolder, file: 'current-hash.json' });
  const { data: hashSigners } = readSignerDataFrom(subfolder);

  if (!hashSigners.includes(address)) {
    return res.status(403).send(`Address not part of hash signers for ${treeType}`);
  }

  const merkleTree = createMerkleTree(currentHash.merkleTreeValues);

  // Set a new signature belonging to the signing address
  currentHash.signatures[address] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = validateTreeRootSignatures(
    `${treeType} root`,
    merkleTree.root,
    currentHash.timestamp,
    currentHash.signatures,
    hashSigners
  );

  const validatedCurrentHash = { ...currentHash, signatures: validatedRootSignatures };

  // Write updated signatures to the file
  writeMerkleTreeData(currentHashPath, validatedCurrentHash);

  // We want to wait for prettier to finish, because otherwise the page will reload and the diff will be created
  // with an unformatted file. Additionally, we only format the current hash file to speed up the process
  await execute(`yarn prettier --write ${currentHashPath}`);

  return res.status(200).send('Successfully signed root');
}

type MerkleTreeCreator = (values: string[][]) => StandardMerkleTree<string[]>;

function getTreeConfig(type: TreeType): [TreeSubFolder, MerkleTreeCreator] {
  switch (type) {
    case DAPI_FALLBACK_MERKLE_TREE_TYPE:
      return ['dapi-fallback-merkle-tree-root', createDapiFallbackMerkleTree];
    case DAPI_MANAGEMENT_MERKLE_TREE_TYPE:
      return ['dapi-management-merkle-tree-root', createDapiManagementMerkleTree];
    case DAPI_PRICING_MERKLE_TREE_TYPE:
      return ['dapi-pricing-merkle-tree-root', createDapiPricingMerkleTree];
    case SIGNED_API_URL_MERKLE_TREE_TYPE:
      return ['signed-api-url-merkle-tree-root', createSignedApiUrlMerkleTree];
  }
}

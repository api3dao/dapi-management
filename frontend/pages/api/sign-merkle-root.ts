import type { NextApiRequest, NextApiResponse } from 'next';
import {
  DAPI_FALLBACK_MERKLE_TREE_TYPE,
  DAPI_MANAGEMENT_MERKLE_TREE_TYPE,
  DAPI_PRICING_MERKLE_TREE_TYPE,
  SIGNED_API_URL_MERKLE_TREE_TYPE,
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

  const subfolder = getSubfolder(treeType);
  const { path: currentHashPath, data: currentHash } = readTreeDataFrom({ subfolder, file: 'current-hash.json' });
  const { data: hashSigners } = readSignerDataFrom(subfolder);

  if (!hashSigners.includes(address)) {
    return res.status(403).send(`Address not part of hash signers for ${treeType}`);
  }

  // Set a new signature belonging to the signing address
  currentHash.signatures[address] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = validateTreeRootSignatures(
    `${treeType} root`,
    currentHash.hash,
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

function getSubfolder(type: TreeType): TreeSubFolder {
  switch (type) {
    case DAPI_FALLBACK_MERKLE_TREE_TYPE:
      return 'dapi-fallback-merkle-tree-root';
    case DAPI_MANAGEMENT_MERKLE_TREE_TYPE:
      return 'dapi-management-merkle-tree-root';
    case DAPI_PRICING_MERKLE_TREE_TYPE:
      return 'dapi-pricing-merkle-tree-root';
    case SIGNED_API_URL_MERKLE_TREE_TYPE:
      return 'signed-api-url-merkle-tree-root';
  }
}

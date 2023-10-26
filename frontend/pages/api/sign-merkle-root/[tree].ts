// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import { join } from 'path';
import { ethers } from 'ethers';
import { format, Options } from 'prettier';
import { validateTreeRootSignatures } from './validators';
import getNodaryFallbackTree from '../../../../chain/fallback/src/tree';

export interface SignMerkleRootRequest {
  signature: string;
  address: string;
}

export interface WalletBallance {
  value: number;
  unit: string;
}

export interface RootSignatureMetadata {
  rootSigners: string[];
  dapiFallbackExecutors: string[];
  minSponsorWalletBalances: Record<string, WalletBallance>;
}

enum MerkleTrees {
  DAPI_FALLBACK = 'DAPI_FALLBACK',
}

const merkleTreeConfig = {
  [MerkleTrees.DAPI_FALLBACK]: {
    getNodaryFallbackTree: getNodaryFallbackTree,
    fallbackTreeValidator: validateTreeRootSignatures,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { tree } = req.query;

  const treeConfig = merkleTreeConfig[tree as MerkleTrees];
  const payload: SignMerkleRootRequest = req.body;
  const { signature, address } = payload;

  // Read current signatures from the file
  const subfolder = process.env.NETWORK === 'localhost' ? 'localhost' : 'data';
  const signaturesPath = join(process.cwd(), '..', 'chain', 'fallback', subfolder, 'root-signatures.json');
  if (!existsSync(signaturesPath)) {
    return res.status(404).send('Signature file not found');
  }
  const signatures: string[] = JSON.parse(readFileSync(signaturesPath, 'utf8'));

  // Read metadata to get the root signers
  const metadataPath = join(process.cwd(), '..', 'chain', 'fallback', subfolder, 'metadata.json');
  if (!existsSync(metadataPath)) {
    return res.status(404).send('Metadata file not found');
  }
  const metadata: RootSignatureMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

  const root = ethers.utils.arrayify(treeConfig.getNodaryFallbackTree().root);

  // Set a new signature on the index belonging to the signing address
  signatures[metadata.rootSigners.indexOf(address)] = signature;

  // for every signer check if the signature is valid and if not replace it with "0x"
  const validatedRootSignatures = treeConfig.fallbackTreeValidator(root, signatures, metadata.rootSigners);

  // Write updated signatures to the file
  writeJsonFile(signaturesPath, validatedRootSignatures);

  return res.status(200).send('');
}

export const PRETTIER_CONFIG: Options = {
  bracketSpacing: true,
  printWidth: 120,
  singleQuote: true,
  trailingComma: 'es5',
  useTabs: false,
};

type JSONValue = string | number | boolean | JSONObject | string[];

interface JSONObject {
  [x: string]: JSONValue;
}

export const prettyJson = (payload: JSONObject | JSONValue) =>
  format(JSON.stringify(payload), { semi: false, parser: 'json', ...PRETTIER_CONFIG });

export const writeJsonFile = (path: string, payload: JSONObject | JSONValue) => {
  writeFileSync(path, prettyJson(payload));
};

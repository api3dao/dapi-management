import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { z } from 'zod';

type TreeSubFolder =
  | 'dapi-fallback-merkle-tree-root'
  | 'dapi-management-merkle-tree-root'
  | 'dapi-pricing-merkle-tree-root'
  | 'signed-api-url-merkle-tree-root';

const merkleTreeSchema = z.object({
  signatures: z.record(z.string()),
  merkleTreeValues: z.object({
    values: z.array(z.array(z.any())),
  }),
});

const signersSchema = z.object({
  hashSigners: z.array(z.string()),
});

type MerkleTreeData = z.infer<typeof merkleTreeSchema>;
type TreeFile = 'current-hash.json' | 'previous-hash.json';

export function readTreeDataFrom(options: { subfolder: TreeSubFolder; file: TreeFile }): {
  path: string;
  data: MerkleTreeData;
};

export function readTreeDataFrom<T>(options: { subfolder: TreeSubFolder; file: TreeFile; schema: z.ZodSchema<T> }): {
  path: string;
  data: T;
};

export function readTreeDataFrom(options: { subfolder: TreeSubFolder; file: TreeFile; schema?: z.ZodSchema }) {
  const { subfolder, file, schema = merkleTreeSchema } = options;
  const path = join(process.cwd(), '../data', subfolder, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    path,
    data: schema.parse(data),
  };
}

export function readSignerDataFrom(subfolder: TreeSubFolder) {
  const path = join(process.cwd(), `../data/${subfolder}/hash-signers.json`);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  return {
    path,
    data: signersSchema.parse(data).hashSigners,
  };
}

export function writeMerkleTreeData(path: string, data: MerkleTreeData) {
  writeFileSync(path, JSON.stringify(data));
}

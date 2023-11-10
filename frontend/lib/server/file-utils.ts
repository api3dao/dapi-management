import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { z } from 'zod';
import isObject from 'lodash/isObject';

const execute = promisify(exec);

export type TreeSubFolder =
  | 'dapi-fallback-merkle-tree-root'
  | 'dapi-management-merkle-tree-root'
  | 'dapi-pricing-merkle-tree-root'
  | 'signed-api-url-merkle-tree-root';

const merkleTreeSchema = z.object({
  timestamp: z.number(),
  hash: z.string(),
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

  // The previous hash file isn't required, so we return if it doesn't exist
  if (file === 'previous-hash.json' && !existsSync(path)) {
    return { path, data: null };
  }

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

export async function createFileDiff(pathA: string, pathB: string) {
  try {
    /*
     * This command produces an exit code of
     *   0: when the file contents are identical
     *   1: when the files contents differ.
     *
     * The exit code of 1 means that the execute() function will throw an error when the contents differ,
     * so we need to handle the error and distinguish a legit diff result from an actual error.
     */
    const result = await execute(`git diff --no-index ${pathA} ${pathB}`);
    return { diff: result.stdout, status: 'success' } as const;
  } catch (resultOrError) {
    if (isGitDiffResult(resultOrError)) {
      return { diff: resultOrError.stdout, status: 'success' } as const;
    }
    console.error(resultOrError);
    return { status: 'error' } as const;
  }
}

interface GitDiffResult {
  code: 1;
  stderr: '';
  stdout: string;
}

function isGitDiffResult(res: unknown): res is GitDiffResult {
  /*
   * The result object where a diff was found will have the shape:
   * {
   *   code: 1,
   *   stderr: '',
   *   stdout: '<some diff text>'
   * }
   */
  return (
    isObject(res) &&
    'code' in res &&
    res.code === 1 &&
    'stderr' in res &&
    res.stderr === '' &&
    'stdout' in res &&
    !!res.stdout
  );
}

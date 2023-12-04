import { z } from 'zod';
import {
  readTreeDataFrom,
  readSignerDataFrom,
  createTreeDiff,
  type MerkleTreeData,
  type TreeSubFolder,
} from './file-utils';

export async function getMerkleTreeServerSideProps<T extends MerkleTreeData>(options: {
  subfolder: TreeSubFolder;
  schema: z.ZodSchema<T>;
  diff: {
    preProcess: boolean;
    preProcessor: (values: T['merkleTreeValues'][number]) => string[];
  };
}) {
  const { subfolder, schema } = options;
  const { path: currentTreePath, data: currentTree } = readTreeDataFrom({
    subfolder,
    file: 'current-hash.json',
    schema,
  });

  const { path: previousTreePath, data: previousTree } = readTreeDataFrom({
    subfolder,
    file: 'previous-hash.json',
    schema,
  });

  const { data: signers } = readSignerDataFrom(subfolder);

  const { preProcess, preProcessor } = options.diff;
  const diffResult = await createTreeDiff({
    subfolder,
    previousData: previousTree,
    previousDataPath: previousTreePath,
    currentData: currentTree,
    currentDataPath: currentTreePath,
    preProcess,
    preProcessor,
  });

  return { currentTree, signers, diffResult };
}

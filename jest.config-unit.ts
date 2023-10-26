import assert from 'node:assert';

import { Config } from '@jest/types';
// Inspired by:
// https://github.com/vercel/next.js/blob/9eaf4f5dc846900cdfcdfb23c63bd4681e686de0/examples/with-jest/jest.config.js.
import nextJest from 'next/jest';

const config: Config.InitialOptions = {
  testMatch: ['**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  restoreMocks: true,
  preset: 'ts-jest',
  setupFiles: ['./jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  modulePathIgnorePatterns: ['<rootDir>/build', '<rootDir>/dist', '<rootDir>/coverage'],
  transform: {
    // Override the next/jest transformations to use "ts-jest" instead of "@swc/jest".
    '^.+\\.(js|jsx|ts|tsx|mjs)$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        isolatedModules: false,
      },
    ],
  },
};

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment.
  dir: './',
});

// We want to use the Jest configuration from Next.js, but we need to modify it slightly to work with ESM, our monorepo
// setup and "ts-jest". Here are the problems and respective workarounds:
//  1) Some of the dependencies are ESM and there is no alternative (e.g. wallet connect v2) and Jest does not support
//     ESM. Also, we can expect there will be more such ESM dependencies in the future.
//  2) We want to use "ts-node" to transpile TS files to JS. By default transforms are ignored for all files in
//     "node_modules". We need to modify the "transformIgnorePatterns" option to change this default behaviour to
//     transpile the problematic dependencies.
//  3) The "transformIgnorePatterns" will exclude a file from transformation if the path matches against ANY pattern
//     provided. This is problem because Next.js also uses this property and ignores everything from "node_modules". We
//     need to rewrite this rule and transpile the problematic dependencies back to CJS. See:
//     https://jestjs.io/docs/tutorial-react-native#transformignorepatterns-customization.
//  4) Next.js does not load ".env.local" during tests. We need to use ".env.test.local" instead. At least we don't need
//     to silence logger in "jest.setup.ts". See:
//     https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#environment-variable-load-order
//  5) The "next/jest" uses "@swc/jest" to transpile TS files to JS, but we want "ts-jest" instead. We do this by
//     overriding their "transform" (since they are merged in an object).
module.exports = async () => {
  const jestConfig = await createJestConfig(config)();
  assert(
    jestConfig.transformIgnorePatterns?.[0] === '/node_modules/',
    'Expected transformIgnorePatterns first element to equal "/node_modules/".'
  );
  jestConfig.transformIgnorePatterns![0] = 'node_modules/(?!(@wagmi|@web3modal|wagmi|uint8arrays|multiformats))';
  assert(Object.keys(jestConfig.transform!).length === 1, 'Expected transform to have exactly one key.');
  return () => Promise.resolve(jestConfig);
};

const fs = require('fs');
const { execSync } = require('child_process');
const { CHAINS } = require('@api3/chains');
const { keyBy } = require('lodash');
const { ethers } = require('ethers');
const { go } = require('@api3/promise-utils');
const { client } = require('../src/database/database');
const { deriveDataFeedId } = require('./utils');
const dapis = require('../data/dapis.json');

const MT_INPUT_PATH = './scripts/dapi-pricing-mt-input.json';
const DEFAULT_SINGLE_UPDATE_GAS_COST = 173000;
const DEFAULT_CHAIN_GAS_MULTIPLIER = 1.5;
const DEFAULT_CHAIN_SUBSCRIPTION_DURATION = 183;

// Custom durations per chainId
const chainSubscriptionDuration = {
  // e.g. 10: 31
};

// Custom gas multiplier per chainId
const chainGasMultiplier = {
  // e.g. 10: 1.5
};

// TODO remove this with API call to Nodary?
// Currently only needed for Mantle pricing
// Values in USD
const chainNativeTokenPrice = { 1: 2200, 5000: 0.62 };

const chainIdToGasOracleContractAddress = {
  534353: '0x5300000000000000000000000000000000000002',
  84531: '0x420000000000000000000000000000000000000F',
  8453: '0x420000000000000000000000000000000000000F',
  5001: '0x420000000000000000000000000000000000000F',
  5000: '0x420000000000000000000000000000000000000F',
  420: '0x420000000000000000000000000000000000000F',
  10: '0x420000000000000000000000000000000000000F',
};

const chainSingleUpdateGasCosts = {
  10: { fixedGasCost: 130000, l1FixedGasCost: 25000 }, // optimism
  420: { fixedGasCost: 130000, l1FixedGasCost: 25000 }, // optimism-testnet
  324: { fixedGasCost: 5400000 }, // zksync
  1101: { fixedGasCost: 180000 }, // zkevm
  1442: { fixedGasCost: 180000 }, // zkevm-testnet
  42161: { fixedGasCost: 145000, l1FixedGasCost: 15000 }, // arbitrum
  421613: { fixedGasCost: 145000, l1FixedGasCost: 15000 }, // arbitrum-testnet
  8453: { fixedGasCost: DEFAULT_SINGLE_UPDATE_GAS_COST, l1FixedGasCost: 27888 }, // base
  84531: { fixedGasCost: DEFAULT_SINGLE_UPDATE_GAS_COST, l1FixedGasCost: 27888 }, // base-testnet
  5000: { fixedGasCost: DEFAULT_SINGLE_UPDATE_GAS_COST, l1FixedGasCost: 1850 }, // mantle
  5001: { fixedGasCost: DEFAULT_SINGLE_UPDATE_GAS_COST, l1FixedGasCost: 1850 }, // mantle-testnet
};

// Derive dataFeedIds and create a mapping for names
const dataFeedNamesByDataFeedId = dapis.reduce(
  (acc, { name, providers }) => ({
    ...acc,
    [deriveDataFeedId(name, providers)]: name,
  }),
  {}
);

async function calculateChainSingleUpdateGasCost(chainId, chainGasOptionsById, rpcUrl) {
  const chainGasOptions = chainGasOptionsById[chainId];
  if (!chainGasOptions) throw new Error(`Missing gas options for chain (${chainId}).`);

  const { averageGasPrice } = chainGasOptions;
  const gasPriceMultiplier = ethers.BigNumber.from(
    (chainGasMultiplier[chainId] ?? DEFAULT_CHAIN_GAS_MULTIPLIER) * 100
  ).div(100);
  const adjustedGasPrice = ethers.BigNumber.from(Math.ceil(gasPriceMultiplier.mul(averageGasPrice).toNumber()));

  const chainSingleUpdateGasCost = chainSingleUpdateGasCosts[chainId] ?? {
    fixedGasCost: DEFAULT_SINGLE_UPDATE_GAS_COST,
  };

  switch (chainId) {
    case '10' /* optimism*/:
    case '420' /* optimism-testnet*/:
    case '5000' /* mantle*/:
    case '5001' /* mantle-testnet*/:
    case '8453' /* base*/:
    case '84531' /* base-testnet*/: {
      const provider = new ethers.providers.StaticJsonRpcProvider(
        {
          url: rpcUrl,
          timeout: 55000,
          allowGzip: true,
        },
        {
          chainId: Number.parseInt(chainId, 10),
          name: chainId,
        }
      );
      const gasOracleContractAddress = chainIdToGasOracleContractAddress[chainId];
      if (!gasOracleContractAddress) throw new Error(`Missing gas oracle contract address for chain (${chainId}).`);

      const gasOracleContract = new ethers.Contract(
        gasOracleContractAddress,
        ['function scalar() view returns (uint256)'],
        provider
      );

      // Get the chain gas fee scalar
      const goScalar = await go(() => gasOracleContract.scalar(), {
        attemptTimeoutMs: 60000,
        retries: 3,
      });

      if (!goScalar.success) {
        throw new Error(
          `Unable to get gas fee scalar on chain (${chainId}). Error: ${JSON.stringify(goScalar.error.message)}.`
        );
      }

      const l2GasCost = ethers.BigNumber.from(chainSingleUpdateGasCost.fixedGasCost).mul(adjustedGasPrice);
      const l1AdjustedGasPrice = ethers.BigNumber.from(Math.ceil(gasPriceMultiplier.mul(averageGasPrice).toNumber()));
      const l1GasCost = ethers.BigNumber.from(chainSingleUpdateGasCost.l1FixedGasCost)
        .mul(l1AdjustedGasPrice)
        .mul(goScalar.data)
        // The scalar must be divided by 1_000_000
        .div(1000000);

      // Calculate the ETH to MNT gas fee conversion for Mantle chains
      if (['5000', '5001'].includes(chainId)) {
        // TODO replace with a GET request to Nodary to get values
        const mntPrice = chainNativeTokenPrice['5000'];
        const ethPrice = chainNativeTokenPrice['1'];
        if (!mntPrice || !ethPrice) {
          throw new Error(`Missing cached ${mntPrice ? 'ETH/USD' : 'MNT/USD'} price to calculate conversion rate.`);
        }

        const ethToMntRatio = Math.ceil(ethPrice / mntPrice);

        return {
          singleUpdate: l2GasCost.add(l1GasCost.mul(ethToMntRatio)),
          adjustedGasPrice,
        };
      }

      return {
        singleUpdate: l2GasCost.add(l1GasCost),
        adjustedGasPrice,
      };
    }

    case '42161' /* arbitrum*/:
    case '421613' /* arbitrum-testnet*/: {
      const l2GasCost = ethers.BigNumber.from(chainSingleUpdateGasCost.fixedGasCost).mul(adjustedGasPrice);
      const l1AdjustedGasPrice = ethers.BigNumber.from(Math.ceil(gasPriceMultiplier.mul(averageGasPrice).toNumber()));
      const l1GasCost = ethers.BigNumber.from(chainSingleUpdateGasCost.l1FixedGasCost).mul(l1AdjustedGasPrice);
      return {
        singleUpdate: l2GasCost.add(l1GasCost),
        adjustedGasPrice,
      };
    }
    case '324' /* zksync*/:
    case '1101' /* zkevm*/:
    case '1442' /* zkevm-testnet*/: {
      return {
        singleUpdate: ethers.BigNumber.from(chainSingleUpdateGasCost.fixedGasCost).mul(adjustedGasPrice),
        adjustedGasPrice,
      };
    }
    default: {
      return {
        singleUpdate: ethers.BigNumber.from(chainSingleUpdateGasCost.fixedGasCost).mul(adjustedGasPrice),
        adjustedGasPrice,
      };
    }
  }
}

async function generateDapiPricingInputs() {
  // Connect to the database
  await client.connect();

  // Calculate average daily update counts for each datafeed
  const dataFeedUpdateCounts = await client.query(`
  WITH "DataComparison" AS (
    SELECT
      "id",
      "airnode",
      "templateId",
      "timestamp",
      "decodedValue",
      "dataFeedId",
      LEAD("decodedValue") OVER (PARTITION BY "airnode", "templateId" ORDER BY "timestamp") AS "nextDecodedValue"
    FROM
      "SignedData"
    WHERE
      "timestamp" >= NOW() - INTERVAL '1 month'
  ),
  "DailyUpdateCounts" AS (
    SELECT
      "dataFeedId",
      CAST(GREATEST(750, COUNT(*) FILTER (WHERE ("decodedValue" > 1.0025 * COALESCE("nextDecodedValue", "decodedValue")
        OR "decodedValue" < 0.9975 * COALESCE("nextDecodedValue", "decodedValue"))
        AND "nextDecodedValue" IS NOT NULL)) AS INTEGER) AS "updateCount_0.25_120",
      CAST(GREATEST(1, COUNT(*) FILTER (WHERE ("decodedValue" > 1.0025 * COALESCE("nextDecodedValue", "decodedValue")
        OR "decodedValue" < 0.9975 * COALESCE("nextDecodedValue", "decodedValue"))
        AND "nextDecodedValue" IS NOT NULL)) AS INTEGER) AS "updateCount_0.25_86400",
      CAST(GREATEST(1, COUNT(*) FILTER (WHERE ("decodedValue" > 1.005 * COALESCE("nextDecodedValue", "decodedValue")
        OR "decodedValue" < 0.995 * COALESCE("nextDecodedValue", "decodedValue"))
        AND "nextDecodedValue" IS NOT NULL)) AS INTEGER) AS "updateCount_0.5_86400",
      CAST(GREATEST(1, COUNT(*) FILTER (WHERE ("decodedValue" > 1.01 * COALESCE("nextDecodedValue", "decodedValue")
        OR "decodedValue" < 0.99 * COALESCE("nextDecodedValue", "decodedValue"))
        AND "nextDecodedValue" IS NOT NULL)) AS INTEGER) AS "updateCount_1_86400"
    FROM
      "DataComparison"
    GROUP BY
      "dataFeedId"
  )
  SELECT
    "dataFeedId",
    CAST(CEIL(AVG("updateCount_0.25_120")) AS INTEGER) AS "avgUpdateCount_0.25_120",
    CAST(CEIL(AVG("updateCount_0.25_86400")) AS INTEGER) AS "avgUpdateCount_0.25_86400",
    CAST(CEIL(AVG("updateCount_0.5_86400")) AS INTEGER) AS "avgUpdateCount_0.5_86400",
    CAST(CEIL(AVG("updateCount_1_86400")) AS INTEGER) AS "avgUpdateCount_1_86400"
  FROM
    "DailyUpdateCounts"
  GROUP BY
    "dataFeedId"
  ORDER BY
    "dataFeedId";
  `);

  const dataFeedUpdateCountsWithOptions = dataFeedUpdateCounts.rows.map(({ dataFeedId, ...updateCountFields }) => {
    const updateCounts = Object.entries(updateCountFields).map(([key, updateCount]) => {
      const [, deviationThreshold, heartbeatInterval] = key.split('_');

      return {
        deviationThreshold: Number.parseFloat(deviationThreshold),
        heartbeatInterval: Number.parseInt(heartbeatInterval, 10),
        updateCount,
      };
    });

    return { dataFeedName: dataFeedNamesByDataFeedId[dataFeedId] ?? 'test', updateCounts };
  });
  // Filter results where a dataFeedName match is not found
  // .filter(({ dataFeedName }) => dataFeedName);

  // Calculate the average monthly gas price for each chain
  const averageChainGasPrices = await client.query(`
  SELECT
    "chainName",
    "chainId",
    "providerName",
    CEIL(AVG("gasPrice")) AS "averageGasPrice",
    MIN("when") AS "startDate",
    MAX("when") AS "endDate"
  FROM
    Public."ProviderGasPrice"
  WHERE
    "when" >= NOW() - INTERVAL '1 month'
  GROUP BY
    "chainName", "chainId", "providerName";
  `);

  // Disconnect from the database
  await client.end();

  // TODO remove this filter for production use
  const filteredAverageChainGasPrices = averageChainGasPrices.rows.filter((r) =>
    CHAINS.map((c) => c.id).includes(r.chainId)
  );

  const chainGasOptionsById = keyBy(filteredAverageChainGasPrices, 'chainId');

  const chainDefaultProviders = keyBy(
    CHAINS.map((c) => ({
      rpcUrl: c.providers.find((p) => p.alias === 'default').rpcUrl,
      chainId: c.id,
    })),
    'chainId'
  );

  const chainSingleUpdateGasCosts = await Promise.all(
    filteredAverageChainGasPrices.map(async (r) => {
      const updateGasCost = await calculateChainSingleUpdateGasCost(
        r.chainId,
        chainGasOptionsById,
        chainDefaultProviders[r.chainId].rpcUrl
      );

      return {
        ...r,
        singleUpdate: updateGasCost.singleUpdate.toString(),
        adjustedGasPrice: updateGasCost.adjustedGasPrice.toString(),
      };
    })
  );

  const merkleTreeValues = chainSingleUpdateGasCosts.flatMap(({ chainId, singleUpdate }) => {
    const chainDuration = chainSubscriptionDuration[chainId] ?? DEFAULT_CHAIN_SUBSCRIPTION_DURATION;
    const chainSingleUpdateGasCost = ethers.BigNumber.from(singleUpdate);

    return dataFeedUpdateCountsWithOptions.flatMap(({ dataFeedName, updateCounts }) =>
      updateCounts.map(({ updateCount, deviationThreshold, heartbeatInterval }) => [
        ethers.utils.formatBytes32String(dataFeedName),
        chainId,
        ethers.utils.defaultAbiCoder.encode(
          ['uint256', 'int224', 'uint32'],
          [(deviationThreshold * 1e8).toString(), '0', heartbeatInterval.toString()]
        ),
        (chainDuration * 24 * 60 * 60).toString(),
        chainSingleUpdateGasCost.mul(updateCount).mul(chainDuration).toString(),
      ])
    );
  });

  fs.writeFileSync(MT_INPUT_PATH, JSON.stringify(merkleTreeValues, null, 2));

  execSync('yarn format');
}

generateDapiPricingInputs();

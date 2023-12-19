const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config();
const { Client } = require('pg');
const { CHAINS } = require('@api3/chains');
const { keyBy, groupBy } = require('lodash');
const { ethers } = require('ethers');
const { go } = require('@api3/promise-utils');
const {
  getAirnodeAddressByAlias,
  deriveDataFeedId: deriveDataFeedIdWithAirnodeAddress,
} = require('@api3/api-integrations');
const dapis = require('../data/dapis.json');
const { deriveBeaconSetId, createDapiPricingMerkleTree } = require('./utils');

const {
  startDate,
  endDate,
  updateCountOptions,
  defaultSingleUpdateGasCost,
  defaultGasMultiplier,
  defaultSubscriptionDuration,
  chainSubscriptionDurations,
  chainGasMultipliers,
  chainIdToGasOracleContractAddress,
  chainSingleUpdateGasCosts,
  updateCountCheckFrequency,
  chainNativeTokenPrices,
} = JSON.parse(fs.readFileSync('./scripts/dapi-pricing-parameters.json', 'utf-8'));

// Set the database credentials
const client = new Client({
  host: process.env.DATABASE_HOST,
  port: process.env.DATABASE_PORT,
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

const MT_OUTPUT_PATH = './data/dapi-pricing-merkle-tree-root/current-hash.json';

function arrayToSqlList(input) {
  return `'${input.join(`','`)}'`;
}

function calculateMedian(arr) {
  if (!arr.length) return undefined;

  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function checkDeviation(currentValue, nextValue, threshold) {
  const absoluteDifference = Math.abs(currentValue - nextValue);
  const percentageDifference = (absoluteDifference / Math.max(Math.abs(currentValue), Math.abs(nextValue))) * 100;

  return percentageDifference > threshold;
}

// This function is copied from utils, but removes the nodary restriction since we need the BeaconSet consituent dataFeedIds as well
function deriveDataFeedId(dapiName, apiProviders) {
  if (apiProviders.length === 1) {
    const airnodeAddress = getAirnodeAddressByAlias(apiProviders[0]);
    return deriveDataFeedIdWithAirnodeAddress(dapiName, airnodeAddress);
  }

  return deriveBeaconSetId(dapiName, apiProviders);
}

async function calculateChainSingleUpdateGasCost(chainId, chainGasOptionsById, rpcUrl) {
  const chainGasOptions = chainGasOptionsById[chainId];
  if (!chainGasOptions) throw new Error(`Missing gas options for chain (${chainId}).`);

  const { averageGasPrice } = chainGasOptions;
  const gasPriceMultiplier = ethers.BigNumber.from((chainGasMultipliers[chainId] ?? defaultGasMultiplier) * 100).div(
    100
  );
  const adjustedGasPrice = ethers.BigNumber.from(Math.ceil(gasPriceMultiplier.mul(averageGasPrice).toNumber()));

  const chainSingleUpdateGasCost = chainSingleUpdateGasCosts[chainId] ?? {
    fixedGasCost: defaultSingleUpdateGasCost,
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
        const mntPrice = chainNativeTokenPrices['5000'];
        const ethPrice = chainNativeTokenPrices['1'];
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

async function generateDapiPricingMT() {
  const calculationEndDate = new Date(endDate);
  const calculationStartDate = new Date(startDate);

  // Connect to the database
  await client.connect();

  // Derive BeaconSet data
  const beaconSetsById = dapis.reduce((acc, { name, providers }) => {
    const beacons = providers.map((provider) => deriveDataFeedId(name, [provider]));

    return {
      ...acc,
      [deriveDataFeedId(name, providers)]: { name, beacons },
    };
  }, {});

  // Initialize update count store
  const beaconSetUpdateCounts = {};

  let nextDate = new Date(calculationStartDate);
  for (const [beaconSetId, { name, beacons }] of Object.entries(beaconSetsById)) {
    console.log(`Checking deviations for ${name} (${beaconSetId}) consiting of ${JSON.stringify(beacons)}`);

    // Get the current and next values
    const tickResults = await client.query(`
      (SELECT DISTINCT ON ("dataFeedId") "decodedValue", "timestamp", 'currentValues' as "set"
      FROM Public."SignedData"
      WHERE "timestamp" >= '${nextDate.toISOString()}'
        AND "timestamp" <= '${calculationEndDate.toISOString()}'
        AND "dataFeedId" IN (${arrayToSqlList(beacons)})
      ORDER BY "dataFeedId", "timestamp" ASC)
      UNION ALL
      (SELECT DISTINCT ON ("dataFeedId") "decodedValue", "timestamp", 'nextValues' as "set"
      FROM Public."SignedData"
      WHERE "timestamp" >= '${new Date(nextDate.getTime() + updateCountCheckFrequency * 1000).toISOString()}'
        AND "timestamp" <= '${calculationEndDate.toISOString()}'
        AND "dataFeedId" IN (${arrayToSqlList(beacons)})
      ORDER BY "dataFeedId", "timestamp" ASC)
    `);

    const { currentValues, nextValues } = groupBy(tickResults.rows, 'set');

    // We've reached the end of the data for the current BeaconSet if there are no more values
    if (!tickResults.rows.length || !currentValues.length || !nextValues.length) {
      // Reset the query date for the next BeaconSet
      nextDate = new Date(calculationStartDate);
      continue;
    }

    // Calculate median values
    const currentMedian = calculateMedian(currentValues.map((cv) => cv.decodedValue));
    const nextMedian = calculateMedian(nextValues.map((nv) => nv.decodedValue));

    // Skip if no medians
    if (!currentMedian || !nextMedian) {
      continue;
    }

    // Check deviations for each configuration
    for (const { deviationThreshold, heartbeatInterval } of updateCountOptions) {
      const exceeded = checkDeviation(currentMedian, nextMedian, deviationThreshold);
      if (exceeded) {
        if (!beaconSetUpdateCounts[beaconSetId])
          beaconSetUpdateCounts[beaconSetId] = { dataFeedName: name, updateCounts: {} };

        beaconSetUpdateCounts[beaconSetId].updateCounts[heartbeatInterval] = {
          ...beaconSetUpdateCounts[beaconSetId].updateCounts[heartbeatInterval],
          [deviationThreshold]:
            (beaconSetUpdateCounts[beaconSetId].updateCounts[heartbeatInterval]?.[deviationThreshold] ?? 0) + 1,
        };
      }
    }

    // Set the date forward by updateCountCheckFrequency for the next iteration
    nextDate = new Date(nextDate.getTime() + updateCountCheckFrequency * 1000);
  }

  const dataFeedUpdateCountsWithOptions = Object.entries(beaconSetUpdateCounts).map(
    ([beaconSetId, { dataFeedName, updateCounts }]) => ({
      dataFeedName,
      beaconSetId,
      updateCounts: Object.entries(updateCounts).flatMap(([heartbeatInterval, updateCountByThreshold]) =>
        Object.entries(updateCountByThreshold).map(([deviationThreshold, updateCount]) => ({
          heartbeatInterval: parseInt(heartbeatInterval),
          deviationThreshold: parseFloat(deviationThreshold),
          updateCount: parseInt(heartbeatInterval === '120' ? (updateCount >= 750 ? updateCount : 750) : updateCount),
        }))
      ),
    })
  );

  // Calculate the average monthly gas price for each chain
  const averageChainGasPrices = await client.query(`  
    SELECT
      provider."chainName",
      provider."chainId",
      CEIL(AVG(gas."gasPrice")) AS "averageGasPrice",
      MIN(gas."when") AS "startDate",
      MAX(gas."when") AS "endDate"
    FROM
      Public."ProviderGasPrice" gas
    JOIN
      Public."Provider" provider ON gas."providerId" = provider."id"
    WHERE
      "when" >= '${calculationStartDate.toISOString()}'
      AND "when" <= '${calculationEndDate.toISOString()}'
    GROUP BY
      provider."chainName", provider."chainId";
  `);

  // Disconnect from the database
  await client.end();

  const chainGasOptionsById = keyBy(averageChainGasPrices.rows, 'chainId');

  const chainDefaultProviders = keyBy(
    CHAINS.map((c) => ({
      rpcUrl: c.providers.find((p) => p.alias === 'default').rpcUrl,
      chainId: c.id,
    })),
    'chainId'
  );

  const chainSingleUpdateGasCosts = await Promise.all(
    averageChainGasPrices.rows.map(async (r) => {
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
    const chainDuration = chainSubscriptionDurations[chainId] ?? defaultSubscriptionDuration;
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

  if (!merkleTreeValues.length) {
    console.log('No data resulting from the query to generate the merkle tree. Exiting early.');
    return;
  }

  const tree = createDapiPricingMerkleTree(merkleTreeValues);

  const dapiPricingMT = {
    timestamp: Math.floor(Date.now() / 1000),
    hash: tree.root,
    signatures: {},
    merkleTreeValues,
  };

  const currentDapiPricingMT = JSON.parse(fs.readFileSync(MT_OUTPUT_PATH, 'utf-8'));

  if (dapiPricingMT.hash === currentDapiPricingMT.hash) {
    console.info('Current hash file is up to date.');
    return;
  } else {
    fs.writeFileSync(
      MT_OUTPUT_PATH.replace('current-hash', 'previous-hash'),
      JSON.stringify(currentDapiPricingMT, null, 2)
    );

    fs.writeFileSync(MT_OUTPUT_PATH, JSON.stringify(dapiPricingMT, null, 2));

    execSync('yarn format');
  }
}

generateDapiPricingMT();

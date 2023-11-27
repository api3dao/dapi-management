
const fs = require("fs");
const prettierConfig = require("../.prettierrc.js");
const prettier = require("prettier");
const { getDecodedParameters } = require("api-integrations");
const { join } = require("path");


function readJson(path) {
  const file = JSON.parse(fs.readFileSync(path).toString());
  return file;
}

const HEADER_CONTENT = `
// ===========================================================================
// DO NOT EDIT THIS FILE MANUALLY!
//
// The contents have been added automatically.
// See: scripts/generate-dapis.js for more information.
// ===========================================================================
`;

const GENERATED_FILES_DIR = "./src/generated";


async function generateDapisJson() {
  const dapisJson = readJson("./data/dapis.json");

  const dapis = dapisJson.map((dapi) => {

    if(dapi.providers.length < 5 || dapi.providers.length % 2 !== 1) {
      if(dapi.category !== "LSD Exchange Rates") {
        throw Error(`${dapi.name} - Invalid number of providers.`);
      }
    }

    if (dapi.providers.length === 1 && dapi.category === "LSD Exchange Rates") {
      const beaconId = "";
      return {
        ...dapi,
        beaconId
      }
    } else {
      const beaconSetId = "";
      return {
        ...dapi,
        beaconSetId
      }
    }

  });

  if (!fs.existsSync(GENERATED_FILES_DIR)) {
    fs.mkdirSync(GENERATED_FILES_DIR);
  }

  const formattedContent = await prettier.format(
    `${HEADER_CONTENT}\nexport const dapis = ${JSON.stringify(
      dapis
    )};`,
    { ...prettierConfig, parser: 'typescript' }
  );
  fs.writeFileSync(join(GENERATED_FILES_DIR, 'apis.js'), formattedContent);

}


generateDapisJson();



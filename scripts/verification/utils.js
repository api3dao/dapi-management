const chalk = require('chalk');

function logSuccessMessage(message) {
  console.log(chalk.green(`\u2713 ${message}`));
}

module.exports = {
  logSuccessMessage,
};

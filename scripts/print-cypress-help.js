const chalk = require('chalk');

console.info('\n');
console.info(chalk.underline('Remember to have:'));
console.info(`- Hardhat running (${command('yarn run node')})`);
console.info(
  `- the frontend running with required env variables (${command('yarn cypress:frontend:dev')} or ${command(
    'yarn cypress:frontend:prod'
  )})`
);
console.info('\n');

function command(command) {
  return chalk.redBright(command);
}

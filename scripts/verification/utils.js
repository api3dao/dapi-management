function logSuccessMessage(message) {
  console.log('\x1b[32m%s\x1b[0m', `\u2713 ${message}`);
}

module.exports = {
  logSuccessMessage,
};

const fs = require('fs');
const dotenv = require('dotenv');
const { env, secret } = require('./api-namespace');

function envFile (filePath) {
  const envFileContent = fs.readFileSync(filePath);
  const envConfig = dotenv.parse(envFileContent);
  for (const key of Object.keys(envConfig)) {
    env(key, envConfig[key]);
  }
}

function secretsFile (filePath) {
  const envFileContent = fs.readFileSync(filePath);
  const envConfig = dotenv.parse(envFileContent);
  for (const key of Object.keys(envConfig)) {
    secret(key, envConfig[key]);
  }
}

module.exports = { envFile, secretsFile };
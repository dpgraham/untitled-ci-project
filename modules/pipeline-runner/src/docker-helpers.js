const Dockerode = require('dockerode');
const { getLogger } = require('./logger');

const logger = getLogger();
const dockerode = new Dockerode();

async function cleanupCarryonContainers (force) {
  const carryOnContainers = await dockerode.listContainers({
    filters: '{"label" : ["carryon"]}',
  });
  logger.info(`Found ${carryOnContainers.length} open carryon containers. Removing...`);

  let promises = [];
  for (const container of carryOnContainers) {
    if (force || container.State !== 'running') {
      promises.push(dockerode.getContainer(container.Id).remove({ force: true }));
    } else {
      logger.info(`Skipping removing running container: ${container.Id}`);
    }
  }
  await Promise.all(promises);
  logger.info(`Removed containers`);
}

module.exports = {
  cleanupCarryonContainers,
};
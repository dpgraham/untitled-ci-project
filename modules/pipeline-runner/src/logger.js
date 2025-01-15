function getLogger () {
  const { createLogger, format, transports } = require('winston');

  const logger = createLogger({
    level: 'info',
    format: format.printf(({ message }) => message),
    transports: [
      new transports.Console(),
      // new transports.File({ filename: 'error.log', level: 'error' }),
      // new transports.File({ filename: 'combined.log' })
    ],
  });

  return logger;
}

module.exports = { getLogger };
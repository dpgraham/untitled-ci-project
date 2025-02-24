let logger;

const IS_DEV = process.env.NODE_ENV === 'development';

function getLogger () {
  if (logger) {return logger;}
  const { createLogger, format, transports } = require('winston');

  logger = createLogger({
    level: (process.env.DEBUG || IS_DEV) ? 'debug' : 'info',
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
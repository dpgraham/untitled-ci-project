const { createLogger, format, transports } = require('winston');

let logger;

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * Gets a singleton instance of Winston logger
 *
 * @returns {winston.Logger}
 */
function getLogger () {
  if (logger) {return logger;}

  logger = createLogger({
    level: (process.env.DEBUG || IS_DEV) ? 'debug' : 'info',
    format: format.combine(
      format.printf(({ message }) => {
        if (logger.shouldNewline) {
          logger.shouldNewline = false;
          return `\n${message}`;
        } else {
          return message;
        }
      }),
    ),
    transports: [
      new transports.Console(),
      // new transports.File({ filename: 'error.log', level: 'error' }),
      // new transports.File({ filename: 'combined.log' })
    ],
  });

  return logger;
}

module.exports = { getLogger };
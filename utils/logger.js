/**
 * TradeSight AI - Structured Console Logger
 */

const LOG_PREFIX = '[TradeSight AI]';

export const Logger = {
  debug: (...args) => console.debug(`${LOG_PREFIX} [DEBUG]`, ...args),
  info: (...args) => console.info(`${LOG_PREFIX} [INFO]`, ...args),
  warn: (...args) => console.warn(`${LOG_PREFIX} [WARN]`, ...args),
  error: (...args) => console.error(`${LOG_PREFIX} [ERROR]`, ...args)
};

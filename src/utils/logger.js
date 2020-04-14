'use strict';

const _ = require('lodash');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs/');

// 2017-04-05 10:02:09.006
function timestamp() {
  // add 1 or 2 leading zeros, default is 1:
  // 1 -> 01, 1 -> 001
  function leadingZero(n, zeros = 1) {
    return `00${n}`.slice((zeros + 1) * -1);
  }

  const now = new Date();

  const date = [
    now.getFullYear(),
    leadingZero(now.getMonth() + 1),
    leadingZero(now.getDate()),
  ].join('-');
  const time = [
    leadingZero(now.getHours()),
    leadingZero(now.getMinutes()),
    leadingZero(now.getSeconds()),
  ].join(':');
  const millis = leadingZero(now.getMilliseconds(), 2);

  return `${date} ${time}.${millis}`;
}

const logFormat = winston.format.printf(
  info => `${timestamp()} - ${info.level}: ${info.message}`
);

const verboseTransport = new DailyRotateFile({
  level: 'verbose',
  name: 'verbose-log',
  filename: path.join(LOG_DIR, 'verbose.log'),
  options: {
    mode: 0o666,
    flags: 'a',
  },
  handleExceptions: true,
  humanReadableUnhandledException: true,
  json: false,
  maxFiles: 10,
  datePattern: 'YYYYMMDD',
  localTime: true,
});

const infoTransport = new DailyRotateFile({
  level: 'info',
  name: 'info-log',
  filename: path.join(LOG_DIR, 'info.log'),
  options: {
    mode: 0o666,
    flags: 'a',
  },
  handleExceptions: true,
  humanReadableUnhandledException: true,
  json: false,
  maxFiles: 10,
  datePattern: 'YYYYMMDD',
  localTime: true,
});

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.splat(),
    logFormat
  ),
  level: 'info',
  handleExceptions: true,
  humanReadableUnhandledException: true,
  json: false,
});

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.splat(),
    logFormat
  ),
  transports: [
    verboseTransport,
    infoTransport,
    consoleTransport,
  ],
});

logger.emitErrs = true;

function log(scp) {
  const m = arguments.length === 1
    ? [arguments[0]]
    : new Array(...arguments);

  let placeHolderStr = _.chain(m)
    .tail()
    .map(msg => ((_.isObject(msg) && !_.isFunction(msg)) ? '%j' : '%s'))
    .join(' ')
    .value();
  placeHolderStr = placeHolderStr ? ` ${placeHolderStr}` : '';

  m[0] = `[${scp}]${placeHolderStr}`;
  if (this.level === 'info') {
    logger.info.call(logger, ...m);
  } else if (this.level === 'verbose') {
    logger.verbose.call(logger, ...m);
  } else if (this.level === 'error') {
    logger.error.call(logger, ...m);
  }
}

module.exports = {
  log: log.bind({ level: 'info' }),
  verbose: log.bind({ level: 'verbose' }),
  error: log.bind({ level: 'error' }),
};

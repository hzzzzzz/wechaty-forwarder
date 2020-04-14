'use strict';

const _ = require('lodash');
const config = require('config');

const logger = require('../utils/logger');


const logError = _.partial(logger.error, 'database');
const log = _.partial(logger.log, 'database');

function getMongoAddress(collection) {
  if (process.env.NODE_ENV === 'testing') {
    return `mongodb://${process.env.MONGO_PORT_27017_TCP_ADDR}:${process.env.MONGO_PORT_27017_TCP_PORT}/${collection}`;
  }

  const addr = _.get(config, 'db.addr', 'localhost');
  const port = _.get(config, 'db.port', 27017);

  return `mongodb://${addr}:${port}/${collection}`;
}

const QUERY_TIMEOUT = 10000; // default
const QUERY_TIMEOUT_SHORT = 2250;
const CONNECT_TIMEOUT = 2000;
const CONNECT_KEEPALIVE = 3000;

function getMongoOptions() {
  return {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    socketTimeoutMS: QUERY_TIMEOUT,
    connectTimeoutMS: CONNECT_TIMEOUT,
    keepAlive: CONNECT_KEEPALIVE,
  };
}

function regConnEventListners(connection) {
  connection.on('connected', function () {
    log('MongoDB connected');
  });
  connection.on('error', function (err) {
    logError('MongoDB connection error,', err);
  });
  connection.on('close', function (err) {
    if (err instanceof Error) {
      logError('MongoDB connection closed,', err);
    } else {
      log('MongoDB connection closed');
    }
  });
  connection.on('reconnected', function () {
    log('MongoDB connection reconnected');
  });
  connection.on('disconnected', function () {
    logError('MongoDB connection disconnected');
  });
  connection.on('connecting', function () {
    log('MongoDB connection reconnecting');
  });
  connection.on('disconnecting', function () {
    log('MongoDB connection disconnecting');
  });
}

module.exports = {
  getMongoAddress,
  getMongoOptions,
  regConnEventListners,
  QUERY_TIMEOUT,
  QUERY_TIMEOUT_SHORT,
  CONNECT_TIMEOUT,
  CONNECT_KEEPALIVE,
};

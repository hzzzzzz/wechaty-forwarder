'use strict';

const _ = require('lodash');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const AsyncLock = require('async-lock');

const db = require('../db/database');
const constants = require('./constants');

moment.tz.setDefault(constants.TIME_ZONE);

const dbConnections = {};

// auto release lock memory if a lock is idle
class Lock {
  constructor(params) {
    this.locks = {};
    this.cleanerTimer = null;
    this.ttl = _.get(params, 'ttl', 60 * 1000); // 60s default
  }

  // delete unused locks
  cleanLocks() {
    const self = this;

    let nextCheck;
    const now = Date.now();

    _.each(this.locks, function (lockObj, key) {
      const lock = _.get(lockObj, 'lock');
      let expire = _.get(lockObj, 'expire');

      // should release lock memory
      if (now >= expire) {
        if (lock && lock.isBusy()) {
          // lock is busy, check again in next tick
          expire += self.ttl;
          if (!nextCheck || expire < nextCheck) {
            nextCheck = expire;
          }
        } else {
          // release memory
          lockObj.lock = null;
          delete self.locks[key];
        }
      } else if (!nextCheck || expire < nextCheck) {
        nextCheck = expire;
      }
    });

    if (nextCheck) {
      this.startLockCleaner(nextCheck - now);
    } else {
      this.cleanerTimer = null;
    }
  }

  startLockCleaner(timeout) {
    this.cleanerTimer = setTimeout(this.cleanLocks.bind(this), timeout);
  }

  getLock(lockName) {
    if (!lockName) {
      return new Error('invalid lockName');
    }

    if (!this.locks[lockName]) {
      this.locks[lockName] = { lock: new AsyncLock() };
    }

    this.locks[lockName].expire = Date.now() + this.ttl;

    if (!this.cleanerTimer) {
      this.startLockCleaner(this.ttl);
    }

    return this.locks[lockName].lock;
  }
}

function wait(waitTime) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, waitTime);
  });
}

// BEGIN: database utils
function connectDb(dbName = constants.DB_NAME) {
  if (!dbName) {
    return new Error('invalid dbName');
  }

  let connection = _.get(dbConnections, dbName);
  const connected = _.includes(
    [mongoose.STATES.connected, mongoose.STATES.connecting],
    _.get(connection, 'readyState')
  );

  if (!connected) {
    connection = mongoose.createConnection(db.getMongoAddress(dbName), db.getMongoOptions());
    _.set(dbConnections, dbName, connection);
    db.regConnEventListners(connection);
  }

  return connection;
}

async function disconnectDb(dbName = constants.DB_NAME) {
  if (!dbName) {
    return new Error('invalid dbName');
  }
  let connection = _.get(dbConnections, dbName);
  if (!connection) {
    return new Error('connection not found');
  }

  try {
    await connection.close();
  } catch (err) {
    return new Error(`disconnectDb failed: ${err.message}`)
  }

  _.unset(dbConnections, dbName);
}
// END: database utils

// remove empty fields in object
function compactObj(obj) {
  if (!_.isPlainObject(obj)) {
    return obj;
  }

  return _.omitBy(obj, (val) => {
    return _.isNil(val)                        // undefined, null
      || (_.isNumber(val) && _.isNaN(val))     // NaN,
      || (_.isDate(val) && isNaN(val))         // Invalid Date
      // [], {}, ''
      || ((_.isArray(val) || _.isPlainObject(val) || _.isString(val)) && _.isEmpty(val));
  });
}

function parseMessage(content, msgType) {
  function parseMiniProgram() {
    const [, appName] = /小程序\[(.+?)\]/.exec(content) || [];
    const [, accId] = /\[ID:(.+?)@app\]/.exec(content) || [];
    const [, title] = /\[标题:(.*?)\]/.exec(content) || [];
    const [, description] = /\[描述:([\s\S]*?)\]/.exec(content) || [];
    const [, pagePath] = /\[页面:(.*?)\]/.exec(content) || [];
    const [, thumbUrl] = /\[预览图地址:(.+?)\]/.exec(content) || [];
    const [, thumbKey] = /\[预览图密钥:(.+?)\]/.exec(content) || [];
    return compactObj({ appName, accId, title, description, pagePath, thumbUrl, thumbKey });
  }

  function parseLocation() {
    const parsed = _.attempt(JSON.parse, content);
    return _.isError(parsed) ? content : parsed;
  }

  function parseContact() {
    const [, name] = /^(.+?),/.exec(content) || [];
    return name ? { name } : content;
  }

  const parsers = {
    [_.toString(constants.MessageType.MiniProgram)]: parseMiniProgram,
    [_.toString(constants.MessageType.Location)]: parseLocation,
    [_.toString(constants.MessageType.Contact)]: parseContact,
  };

  const parser = _.get(parsers, _.toString(msgType));

  return _.isFunction(parser) ? parser(content) : content;
}

module.exports = {
  moment,

  Lock,

  wait,

  connectDb,
  disconnectDb,

  compactObj,

  parseMessage,
};


'use strict';

const _ = require('lodash');
const WebSocket = require('isomorphic-ws');
const async = require('async');
const mongoose = require('mongoose');

const MacBot = require('../bot/macbot').MacBot;
const utils = require('../utils/utils');
const constants = require('../utils/constants');
const logger = require('../utils/logger');


const logError = _.partial(logger.error, 'serverHelper');
const log = _.partial(logger.log, 'serverHelper');

// global instances:
let webSocket;

const bot = new MacBot({
  token: constants.PUPPET_TOKEN,
  name: constants.PUPPET_NAME,
});

/**
 * generate success reponse body for API call
 *
 * samples:
 *
 *   input: { foo: 'this is content' }
 *   output: { data: { foo: 'this is content' } }
 *
 *   input: 'this is a message'
 *   output: { data: 'this is a message' }
 */
function genApiSuccessBody(content) {
  return { data: content || {} };
}

/**
 * generate error reponse body for API call
 *
 * samples:
 *
 *   input: 'this is error message'
 *   output: { error: { message: 'this is error message' } }
 *
 *   input: new Error('some error')
 *   output: { error: { message: 'some error' } }
 *
 * you can also specify an error code in second param
 */
function genApiErrorBody(errMsg, errCode) {
  errMsg = _.isError(errMsg) ? _.get(errMsg, 'message') : errMsg;

  if (_.isEmpty(errMsg)) {
    logError('should specify error message for API response');
    errMsg = 'got error, but description not set';
  }

  const errDetail = {
    message: errMsg,
  };
  if (errCode) {
    errDetail.code = errCode;
  }

  return { error: errDetail };
}

function startWebSocketServer() {
  if (webSocket instanceof WebSocket.Server) {
    return;
  }

  webSocket = new WebSocket.Server({ port: constants.SERVER_PORT_WS });
}

function wsBroadcast(data) {
  if (!(webSocket instanceof WebSocket.Server)) {
    return;
  }

  webSocket.clients.forEach((client) => {
    if (_.get(client, 'readyState') === WebSocket.OPEN) {
      const dataStr = _.attempt(JSON.stringify, genApiSuccessBody(data));
      client.send(_.isError(dataStr) ? data : dataStr);
    }
  });
}

function onBotLogin() {
  wsBroadcast({ botStatus: 'online' });
}

function onBotScan(code, status) {
  const data = {
    botStatus: 'scanning',
    scanStatus: _.get(constants.ScanStatus, status),
  };

  if (status === constants.ScanStatus.Waiting) {
    if (_.isEmpty(code)) {
      _.merge(data, { action: 'confirm' });
    } else {
      _.merge(data, { action: 'scan', qrCode: code });
    }
  }

  wsBroadcast(data);
}

async function onBotLogout() {
  await bot.stop();

  wsBroadcast({ botStatus: 'offline' });
}

async function botOnline() {
  if (bot.isOnline()) {
    wsBroadcast({ botStatus: 'online' });
    return;
  }

  bot.setListener('login', onBotLogin);
  bot.setListener('scan', onBotScan);
  bot.setListener('logout', onBotLogout);

  const started = await bot.start();
  if (_.isError(started)) {
    return started;
  }

  if (_.get(started, 'botStatus') === 'scanning') {
    const { code, status } = _.get(started, 'detail', {});
    onBotScan(code, status);
  }
}

async function botLogout() {
  if (!bot.isOnline()) {
    return;
  }

  return bot.logout();
}

async function findGroups(filter, projection) {
  const condition = _.merge({ user: _.get(bot, 'profile.id') }, filter);

  let found;
  try {
    found = await bot.dbModels.room.Model.find(
      condition,
      projection || { _id: 0, __v: 0 },
      { lean: true, sort: { name: 1 } }
    ).exec();
  } catch (err) {
    return err;
  }

  return projection
    ? _.map(found, itm => _.pick(itm, _.keys(projection)))
    : found;
}

async function findMessages(senderId, limit = 10) {
  let found;
  const myId = _.get(bot, 'profile.id');
  const condition = { user: myId, to: myId };

  if (senderId) {
    condition.from = senderId;
  }

  try {
    found = await bot.dbModels.message.Model.find(
      condition,
      { __v: 0 },
      { lean: true, limit, sort: { date: -1 } }
    ).exec();
  } catch (err) {
    return err;
  }

  return _.map(found, (msg) => {
    let text = msg.text;
    const parsed = utils.parseMessage(msg.text, msg.type);
    if (msg.type === constants.MessageType.MiniProgram) {
      text = _.get(parsed, 'title');
      if (!text) {
        text = _.get(parsed, 'description') || constants.MINIPROGRAM_TITLE;
      }
    } else if (msg.type === constants.MessageType.Contact) {
      if (_.get(parsed, 'name')) {
        text = _.get(parsed, 'name');
      }
    }
    return {
      _id: msg._id.toString(),
      date: msg.date,
      text,
      type: msg.type,
    };
  });
}

async function genMsgParams(messageId) {
  let msg;
  try {
    msg = await bot.dbModels.message.Model.findOne(
      { _id: mongoose.Types.ObjectId(messageId) },
      { type: 1, text: 1 },
      { lean: true }
    ).exec();
  } catch (err) {
    return err;
  }

  if (_.isEmpty(msg)) {
    return new Error('message not found');
  }

  const parsed = utils.parseMessage(msg.text, msg.type);

  const data = {
    type: msg.type,
  };

  if (msg.type === constants.MessageType.MiniProgram) {
    data.params = {
      appid: _.get(parsed, 'accId') || constants.MINIPROGRAM_ACCID,
      title: _.get(parsed, 'title') || constants.MINIPROGRAM_TITLE,
      pagePath: _.get(parsed, 'pagePath'),
      thumbUrl: _.get(parsed, 'thumbUrl'),
      thumbKey: _.get(parsed, 'thumbKey'),
    };
  } else {
    data.params = parsed;
  }

  return data;
}

function mapMsgParams(messageIds) {
  return new Promise((resolve) => {
    async.map(
      messageIds,
      async (messageId) => {
        const msg = await genMsgParams(messageId);
        if (_.isError(msg)) {
          throw msg;
        }
        return msg;
      },
      (err, res) => {
        resolve(err || res);
      }
    );
  });
}

async function sendMessage(params, msgType, target, targetType) {
  if (!bot.isOnline()) {
    return new Error('bot offline');
  }
  const targetStr = targetType === 'room'
    ? `group ${target}`
    : `contact ${target}`;

  log(`send message to ${targetStr}, params:\n${JSON.stringify(params)}`);
  return bot.sendMessage(params, msgType, target, targetType);
}

function newMessageQueue() {
  const q = async.queue(
    async (task) => {
      const { params, type, groupId, interval } = task || {};
      if (_.isEmpty(params) || _.isNil(type) || !groupId) {
        return new Error('invalid params');
      }

      const send = await sendMessage(params, type, groupId, 'room');
      if (!_.isError(send)) {
        await utils.wait(interval || 3000);
      }
    },
    1
  );

  q.drain(() => {
    wsBroadcast({ botStatus: 'idle' });
  });

  return q;
}

const messageQueue = newMessageQueue();

function queueTasks(messages, groupIds, groupInterval = 10000, msgInterval = 3000) {
  _.each(
    groupIds,
    (groupId) => {
      _.each(
        messages,
        (message, index) => {
          const task = _.merge(
            {
              groupId,
              interval: index === _.size(messages) - 1 ? groupInterval : msgInterval,
            },
            message // { params, type }
          );
          messageQueue.push(task);
        }
      );
    }
  );
}

async function queueForwards(messageIds, groupIds) {
  if (!_.isArray(messageIds)) {
    messageIds = [messageIds];
  }
  if (!_.isArray(groupIds)) {
    groupIds = [groupIds];
  }
  messageIds = _.compact(messageIds);
  groupIds = _.compact(groupIds);
  if (_.isEmpty(messageIds) || _.isEmpty(groupIds)) {
    return new Error('invalid params');
  }

  const messages = await mapMsgParams(messageIds);
  if (_.isError(messages)) {
    return messages;
  }

  queueTasks(messages, groupIds);
}


module.exports = {
  genApiSuccessBody,
  genApiErrorBody,

  startWebSocketServer,
  botOnline,
  botLogout,

  findGroups,
  findMessages,
  queueForwards,
};

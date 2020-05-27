'use strict';

const _ = require('lodash');
const async = require('async');
const uuid = require('uuid').v1;

const WinBot = require('../bot/hostie').Bot;
const MacBot = require('../bot/macpro').Bot;
const PadBot = require('../bot/padplus').Bot;

const webSocket = require('./websocket');
const utils = require('../utils/utils');
const constants = require('../utils/constants');
const logger = require('../utils/logger');


const logError = _.partial(logger.error, 'serverHelper');
const log = _.partial(logger.log, 'serverHelper');


let Bot;
if (constants.PUPPET_TYPE === 'hostie') {
  Bot = WinBot;
} else if (constants.PUPPET_TYPE === 'macPro') {
  Bot = MacBot;
} else if (constants.PUPPET_TYPE === 'padPlus') {
  Bot = PadBot;
}

const bot = new Bot({
  token: constants.PUPPET_TOKEN,
  name: constants.PUPPET_NAME,
});

const token = uuid();

function onBotLogin(clientId) {
  webSocket.broadcast({ botStatus: 'online' }, clientId);
}
async function onBotScan(code, status) {
  const data = {
    botStatus: 'scanning',
    scanStatus: _.get(constants.ScanStatus, status),
  };

  if (status === constants.ScanStatus.Waiting) {
    if (_.isEmpty(code)) {
      _.merge(data, { action: 'confirm' });
    } else {
      let qrCode = await utils.genQrcode(code, 'dataUrl');
      if (_.isError(qrCode)) {
        logError(`cast qrcode '${code}' to dataUrl failed: ${qrCode.message}`);
        qrCode = code;
      }

      _.merge(data, { action: 'scan', qrCode });
    }
  }

  webSocket.broadcast(data);
}
async function onBotLogout() {
  await bot.stop();

  webSocket.broadcast({ botStatus: 'offline' });
}

async function botOnline(clientId) {
  if (bot.isOnline()) {
    webSocket.broadcast({ botStatus: 'online' }, clientId);
    return;
  }

  bot.setListener('login', _.partial(onBotLogin, clientId), true);
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
      { lean: true }
    ).exec();
  } catch (err) {
    return err;
  }

  return projection
    ? _.map(found, itm => _.pick(itm, _.keys(projection)))
    : found;
}

async function findGroupMembers(groupId) {
  const myId = _.get(bot, 'profile.id');
  const condition = { user: myId, id: groupId };

  let group;
  try {
    group = await bot.dbModels.room.Model.findOne(
      condition,
      { memberList: 1 },
      { lean: true }
    ).exec();
  } catch (err) {
    return err;
  }

  const memberList = _.get(group, 'memberList');
  if (_.isEmpty(memberList)) {
    return new Error('group not found');
  }

  const projection = { id: 1, wechat: 1, name: 1, alias: 1, avatar: 1, blacklisted: 1 };
  let contacts;
  try {
    contacts = await bot.dbModels.contact.Model.find(
      { users: myId, id: { $in: memberList } },
      projection,
      { lean: true }
    ).exec();
  } catch (err) {
    return err;
  }

  return _.map(contacts, itm => _.pick(itm, _.keys(projection)));
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
      { __v: 0, _id: 0 },
      { lean: true, limit, sort: { date: -1 } }
    ).exec();
  } catch (err) {
    return err;
  }

  const messages = _.map(found, (msg) => {
    let text = msg.text;
    const parsed = utils.parseMessage(msg.text, msg.type);
    if (msg.type === constants.MessageType.MiniProgram) {
      text = _.get(parsed, 'title');
      if (!text) {
        text = _.get(parsed, 'description') || constants.MINIPROGRAM_TITLE;
      }
    } else if (msg.type === constants.MessageType.Contact) {
      if (_.get(parsed, 'name')) {
        text = _.get(parsed, 'name', 'unknown');
      }
    }

    return {
      id: msg.id,
      date: msg.date,
      text,
      from: msg.from,
      type: msg.type,
    };
  });

  const senderProjection = {
    id: 1,
    name: 1,
    wechat: 1,
    avatar: 1,
  };
  const senderIds = _.keys(_.groupBy(messages, 'from'));
  let senders = await bot.dbModels.contact.findContacts(myId, senderIds, senderProjection);
  if (!_.isError(senders) && !_.isEmpty(senders)) {
    senders = _.map(senders, s => _.pick(s, _.keys(senderProjection)));
    _.each(messages, (msg) => {
      const senderInfo = _.find(senders, sender => _.get(sender, 'id') === msg.from);
      msg.from = senderInfo;
    });
  }

  return messages;
}

async function genMsgParams(messageId) {
  let msg;
  try {
    msg = await bot.dbModels.message.Model.findOne(
      { id: messageId },
      { type: 1, text: 1, id: 1 },
      { lean: true }
    ).exec();
  } catch (err) {
    return err;
  }

  if (_.isEmpty(msg)) {
    return new Error('message not found');
  }

  const params = await bot.genForwardParams(null, msg);
  if (_.isError(params)) {
    return params;
  }

  return {
    type: msg.type,
    id: messageId,
    params,
  };
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

function ackTaskFinished(taskId = 'foo', clientId) {
  webSocket.broadcast(
    {
      botStatus: 'running',
      // FIXME
      taskId,
      taskStatus: 'finish',
    },
    clientId
  );
}

function ackMessageStatus(groupId, messageId, taskId = 'foo', clientId, failed = false) {
  webSocket.broadcast(
    {
      botStatus: 'running',
      taskId,
      taskStatus: 'running',
      messageStatus: failed ? 'failed' : 'send',
      groupId,
      messageId,
    },
    clientId
  );
}

function genTaskId() {
  return Date.now();
}

async function queueTask(messageIds, groupIds, taskId, clientId) {
  const messagesParams = await mapMsgParams(messageIds);
  if (_.isError(messagesParams)) {
    logError(`queueTask failed: gen messageParams failed: ${messagesParams.message}`);
    return messagesParams;
  }

  const task = {
    messages: _.flatMap(
      groupIds,
      (groupId, groupIndex) => _.map(
        messagesParams,
        (messageParams, msgIndex) => {
          // { groupId, callback, params, type, id }
          const taskParams = _.merge(
            {
              groupId,
              callback: _.partial(ackMessageStatus, groupId, messageParams.id, taskId, clientId),
            },
            messageParams
          );
          if (msgIndex === _.size(messagesParams) - 1) {
            taskParams.lastGroupMessage = true;

            if (groupIndex === _.size(groupIds) - 1) {
              taskParams.lastTaskMessage = true;
            }
          }
          return taskParams;
        }
      )
    ),
    callback: _.partial(ackTaskFinished, taskId, clientId),
  };

  bot.sendGroupMessageQueue.push(task);

  return taskId;
}

async function queueForwards(messageIds, groupIds, clientId) {
  if (!_.isArray(messageIds)) {
    messageIds = [messageIds];
  }
  if (!_.isArray(groupIds)) {
    groupIds = [groupIds];
  }

  const taskId = genTaskId();
  messageIds = _.compact(messageIds);
  groupIds = _.compact(groupIds);

  if (_.isEmpty(messageIds) || _.isEmpty(groupIds)) {
    return new Error('invalid params');
  }

  log(
    `queueForwards: clientId: ${clientId}, taskId: ${taskId}, messageIds: ${messageIds}, groupIds: ${groupIds}`
  );

  return queueTask(messageIds, groupIds, taskId, clientId);
}

async function blacklistContacts(adds, removes) {
  if (_.isString(adds)) {
    adds = [adds];
  }
  if (_.isString(removes)) {
    removes = [removes];
  }

  adds = _.uniq(_.compact(adds));
  removes = _.uniq(_.compact(removes));

  if (!_.isEmpty(adds)) {
    try {
      await bot.dbModels.contact.Model.update(
        { id: { $in: adds } },
        { $set: { blacklisted: true } },
        { multi: true }
      ).exec();
    } catch (err) {
      return err;
    }
  }

  if (!_.isEmpty(removes)) {
    try {
      await bot.dbModels.contact.Model.update(
        { id: { $in: removes } },
        { $set: { blacklisted: false } },
        { multi: true }
      ).exec();
    } catch (err) {
      return err;
    }
  }
}

async function refreshContact(contactId) {
  if (!contactId) {
    return new Error('invalid contactId');
  }
  return bot.refreshContact(contactId);
}

async function refreshGroup(groupId) {
  if (!groupId) {
    return new Error('invalid groupId');
  }
  return bot.refreshGroup(groupId);
}

module.exports = {
  token,

  botOnline,
  botLogout,

  findGroups,
  findMessages,
  findGroupMembers,
  queueForwards,
  blacklistContacts,
  refreshContact,
  refreshGroup,
};

'use strict';

const _ = require('lodash');
const PuppetPadplus = require('wechaty-puppet-padplus').PuppetPadplus;

const PuppetBot = require('./base').Bot;
const constants = require('../utils/constants');
const utils = require('../utils/utils');


class Bot extends PuppetBot {
  constructor(params) {
    _.set(params, 'Puppet', _.get(params, 'Puppet', PuppetPadplus));
    super(params);
  }

  async onMessage(msg) {
    const msgData = utils.compactObj(
      {
        from: _.get(msg.from(), 'id'),
        to: _.get(msg.to(), 'id'),
        id: _.get(msg, 'id'),
        type: msg.type(),
        date: msg.date(),
        text: msg.text(),
        room: _.get(msg.room(), 'id'),
        mentionList: _.compact(_.map(msg.mentionList(), 'id')),
      }
    );

    if (msgData.type === constants.MessageType.MiniProgram) {
      let miniPayload;
      try {
        miniPayload = await msg.toMiniProgram();
      } catch (err) {
        this.error(`Cast message to miniProgram failed: ${err.message}, message: ${msg}`);
      }

      if (miniPayload) {
        msgData.text = JSON.stringify(miniPayload.payload);
      }
    }

    if (msg.mentionSelf()) {
      msgData.mentionSelf = true;
    }
    if (msg.self()) {
      msgData.self = true;
    }

    if (msgData.room) {
      await this.getGroup(msgData.room); // store group info if not in db
    }

    this.verbose('got Message:', JSON.stringify(msgData));

    await this.storeMessage(msgData);
  }

  async genForwardParams(messageId, msg) {
    if (messageId && _.isEmpty(msg)) {
      try {
        msg = await this.dbModels.message.Model.findOne(
          { id: messageId },
          { type: 1, text: 1, id: 1 },
          { lean: true }
        ).exec();
      } catch (err) {
        return err;
      }
    }

    if (_.isEmpty(msg)) {
      return new Error('message not found');
    }

    const parsed = utils.parseMessage(_.get(msg, 'text'), _.get(msg, 'type'));
    if (_.isError(parsed) || _.isEmpty(parsed)) {
      return parsed || new Error('invalid message');
    }

    const params = parsed;
    if (msg.type === constants.MessageType.MiniProgram) {
      if (params.isPayload) {
        _.unset(params, 'isPayload');
      }
    }

    return params;
  }
}

module.exports = {
  Bot,
};

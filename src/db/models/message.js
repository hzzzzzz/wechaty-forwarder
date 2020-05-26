'use strict';

const mongoose = require('mongoose');
const _ = require('lodash');

// const constants = require('../../utils/constants');
const utils = require('../../utils/utils');
const logger = require('../../utils/logger');

const logError = _.partial(logger.error, 'messageModel');
const logVerbose = _.partial(logger.verbose, 'messageModel');

// const TYPES_ENUM = _.values(constants.MessageType);

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true },
    user: String,                               // contactId of current wechat account
    from: String,                               // contactId of sender
    to: String,                                 // contactId of receiver
    // type: { type: Number, enum: TYPES_ENUM },
    type: Number,
    date: Date,
    text: String,
    room: String,
    mentionSelf: Boolean,
    self: Boolean,
    mentionList: [String],
  }
);

messageSchema.index({
  user: 1,
  date: -1,
});
messageSchema.index({
  user: 1,
  type: 1,
  date: -1,
});
messageSchema.index({
  from: 1,
  date: -1,
});
messageSchema.index(
  {
    user: 1,
    room: 1,
    date: -1,
  },
  { partialFilterExpression: { room: { $exists: true } } }
);

const DEFAULT_PROJECTION = _.chain(messageSchema)
  .get('obj')
  .transform(
    (result, value, key) => { result[key] = 1; },
    {}
  )
  .omit('user')
  .set('_id', 0)
  .value();

class Message {
  constructor(conn) {
    if (conn) {
      if (conn instanceof mongoose.Connection) {
        this.Model = conn.model('messages', messageSchema);
      } else {
        logError('new Message with invalid connection, use default connection instead');
        this.Model = mongoose.model('messages', messageSchema);
      }
    } else {
      this.Model = mongoose.model('messages', messageSchema);
    }
  }

  async addMessage(currentUserId, message) {
    logVerbose(
      `addMessage, currentUser=${currentUserId}, message=${JSON.stringify(message)}`
    );
    if (!currentUserId) {
      return new Error('contactId of current user must be specified');
    }
    if (!_.isPlainObject(message) || _.isEmpty(message)) {
      return new Error('invalid message');
    }

    let msgDate = utils.moment(_.get(message, 'date'));
    if (!msgDate.isValid()) {
      msgDate = utils.moment();
    }
    const doc = _.defaults(
      {
        user: currentUserId,
        date: msgDate.toDate(),
      },
      message
    );

    try {
      const inserted = await this.Model.insertMany(doc);
      return inserted;
    } catch (err) {
      logError(`addMessage failed: ${err.message}`);
      return err;
    }
  }
}

let defaultInstance;
function instance(conn) {
  if (!(conn instanceof mongoose.Connection)) {
    if (!defaultInstance) {
      defaultInstance = new Message();
    }
    return defaultInstance;
  }

  return new Message(conn);
}

module.exports = {
  DEFAULT_PROJECTION,

  instance,
};

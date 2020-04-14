'use strict';

const mongoose = require('mongoose');
const _ = require('lodash');

const logger = require('../../utils/logger');

const logError = _.partial(logger.error, 'roomModel');
const logVerbose = _.partial(logger.verbose, 'roomModel');

const roomSchema = new mongoose.Schema(
  {
    user: String,                               // contactId of current wechat account
    id: { type: String, unique: true },
    name: String,
    avatar: String,
    owner: String,                              // contactId of owner
    memberList: [String],                       // contactId of members
    adminList: [String],                        // list of admin contactIds
  }
);

roomSchema.index({
  user: 1,
});
roomSchema.index({
  user: 1,
  name: 1,
});

const DEFAULT_PROJECTION = _.chain(roomSchema)
  .get('obj')
  .transform(
    (result, value, key) => { result[key] = 1 },
    {}
  )
  .omit('user')
  .set('_id', 0)
  .value();

class Room {
  constructor(conn) {
    if (conn) {
      if (conn instanceof mongoose.Connection) {
        this.Model = conn.model('rooms', roomSchema);
      } else {
        logError('new Room with invalid connection, use default connection instead');
        this.Model = mongoose.model('rooms', roomSchema);
      }
    } else {
      this.Model = mongoose.model('rooms', roomSchema);
    }
  }

  async addOrUpdateRoom(currentUserId, roomInfo) {
    logVerbose(
      'addOrUpdateRoom, currentUser=', currentUserId, 'roomInfo=', roomInfo
    );

    if (!currentUserId) {
      return new Error('invalid currentUserId');
    }
    const roomId = _.get(roomInfo, 'id');
    if (!roomId) {
      return new Error('invalid roomId');
    }

    try {
      const updated = await this.Model.updateOne(
        { user: currentUserId, id: roomId },
        {
          $set: roomInfo,
        },
        { upsert: true },
      ).exec();
      return updated;
    } catch (err) {
      logError(`addOrUpdateRoom failed: ${err.message}`);
      return err;
    }
  }

  async updateRoomMembers(currentUserId, roomId, memberList) {
    logVerbose(
      'updateRoomMembers, currentUser=', currentUserId, 'roomId=', roomId, 'memberList=', memberList
    );

    if (!currentUserId) {
      return new Error('invalid currentUserId');
    }
    if (!roomId) {
      return new Error('invalid roomId');
    }
    if (!_.isArray(memberList) || _.isEmpty(memberList)) {
      return new Error('invalid memberList');
    }

    try {
      const updated = await this.Model.updateOne(
        { user: currentUserId, id: roomId },
        {
          $set: { memberList }
        }
      ).exec();
      return updated;
    } catch (err) {
      logError(`updateRoomMembers failed: ${err.message}`);
      return err;
    }
  }

  async findRooms(currentUserId, roomIds, projection = DEFAULT_PROJECTION) {
    if (!currentUserId) {
      return new Error('invalid currentUserId');
    }

    const condition = { user: currentUserId };
    if (roomIds) {
      if (!_.isArray(roomIds)) {
        roomIds = [roomIds];
      }
      condition.id = { $in: roomIds };
    }

    try {
      const found = await this.Model.find(condition, projection, { lean: true }).exec();
      return found;
    } catch (err) {
      logError(`findRooms failed: ${err.message}`);
      return err;
    }
  }
}

let defaultInstance;
function instance(conn) {
  if (!(conn instanceof mongoose.Connection)) {
    if (!defaultInstance) {
      defaultInstance = new Room();
    }
    return defaultInstance;
  }

  return new Room(conn);
}

module.exports = {
  DEFAULT_PROJECTION,

  instance,
};
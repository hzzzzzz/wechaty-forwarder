'use strict';

const _ = require('lodash');
const wechaty = require('wechaty');
const async = require('async');
const fs = require('fs-extra');
const path = require('path');

const logger = require('../utils/logger');
const constants = require('../utils/constants');
const utils = require('../utils/utils');

const contactDb = require('../db/models/contact');
const messageDb = require('../db/models/message');
const roomDb = require('../db/models/room');

// unit in ms
function genInterval(k, a, b, count) {
  return _.toInteger(1000 * k / (1 + Math.exp(a - b * count)));
}

function genJoinGroupInterval(count) {
  const interval = -40 * 1000 + genInterval(170, 2, 0.8, count);
  return _.max([5000, interval]);
}

function genSendGroupMessageInterval(count) {
  const interval = -10 * 1000 + genInterval(71, 2, 0.5, count);
  return _.max([5000, interval]);
}

class Bot {
  constructor(params) {
    this.token = _.get(params, 'token');
    this.name = _.get(params, 'name', 'bot');
    this.db = _.get(params, 'db', 'wechaty');
    this.pendingScan = null;
    this.online = false;

    if (!this.token) {
      return;
    }

    const Puppet = _.get(params, 'Puppet');
    if (!Puppet) {
      return;
    }

    this.wechaty = wechaty.Wechaty.instance({
      puppet: new Puppet({ token: this.token }),
      name: this.name,
    });

    // setup loggers
    this.log = _.partial(logger.log, `${this.name}`);
    this.verbose = _.partial(logger.verbose, `${this.name}`);
    this.error = _.partial(logger.error, `${this.name}`);

    // ensure dirs
    _.each([constants.AVATAR_DIR], (dir) => {
      const ensured = _.attempt(fs.ensureDirSync, dir);
      if (_.isError(ensured)) {
        this.error(`ensure dir ${dir} failed`);
      }
    });

    // create lock
    this.lock = new utils.Lock();

    // connect database
    this.dbConnection = utils.connectDb(this.db);
    this.dbModels = {
      contact: contactDb.instance(this.dbConnection),
      message: messageDb.instance(this.dbConnection),
      room: roomDb.instance(this.dbConnection),
    };

    // setup listeners
    _.each(
      {
        scan: this.onScan,
        login: this.onLogin,
        logout: this.onLogout,
        message: this.onMessage,
        'room-invite': this.onInvite,
      },
      (listener, event) => {
        const listenerOk = this.setListener(event, listener.bind(this));
        if (_.isError(listenerOk)) {
          this.error(`init '${event}' listener failed: ${listenerOk.message}`);
        }
      }
    );

    this.initSendGroupMessageQueue();
    this.initAcceptGroupInvitionQueue();
  }

  // BEGIN: basic functions

  isOnline() {
    // return this.wechaty.logonoff(); // not reliable
    return this.wechaty.logonoff() && (this.online === true);
  }

  isWaitingForScan() {
    return !_.isEmpty(this.pendingScan);
  }

  setListener(event, listener) {
    this.verbose(`setListener: '${event}'`);

    let errMsg;
    if (!event || !_.isFunction(listener)) {
      errMsg = `setListener '${event}' failed: invalid args`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    if (_.includes(this.wechaty.listeners(event), listener)) {
      errMsg = `setListener '${event}' failed: listener already set`;
      this.verbose(errMsg);
      return;
    }

    this.wechaty.addListener(event, listener);
  }

  removeListener(event, listener) {
    this.verbose(`try remove listener: ${event}`);

    let errMsg;
    if (!event || (listener && !_.isFunction(listener))) {
      errMsg = 'invalid args';
    }

    if (errMsg) {
      errMsg = `removeListener failed: ${errMsg}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    if (listener) {
      this.wechaty.removeListener(event, listener);
    } else {
      this.wechaty.removeAllListeners(event);
    }
  }

  onScan(code, status) {
    if (status === constants.ScanStatus.Waiting) {
      this.pendingScan = { code, status };
    } else {
      this.pendingScan = null;

      if ([constants.ScanStatus.Cancel, constants.ScanStatus.Timeout].includes(status)) {
        this.wechaty.stop();
        this.wechaty.start();
      }
    }

    this.verbose(`Scan: status: ${status}, code: ${code}`);
  }

  async onLogin(me) {
    const myId = _.get(me, 'id');
    this.profile = { id: myId };

    this.pendingScan = null;
    this.online = true;

    const myInfo = await this.extractContactInfo(me);
    if (!_.isError(myInfo)) {
      this.profile = myInfo;
    }

    this.log(`onLogin: ${myId}`);
  }

  async onInvite(roomInvitation) {
    let groupName = '';

    try {
      groupName = await roomInvitation.roomTopic();
    } catch (err) {
      // do nothing
    }

    let inviter;
    let inviterName = '';

    try {
      inviter = await roomInvitation.inviter();
      inviterName = inviter.name();
    } catch (err) {
      // do nothing
    }

    this.log(`receive group ${groupName} invitation from ${inviterName}`);

    this.acceptGroupInvitionQueue.push({
      invitation: roomInvitation,
      groupName,
      inviterName,
    });
  }

  onLogout() {
    this.pendingScan = null;
    this.online = false;

    this.log(`onLogout: ${_.get(this.profile, 'id')}`);
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


  async start() {
    this.verbose('try start bot');

    if (this.isWaitingForScan()) {
      return {
        botStatus: 'scanning',
        detail: this.pendingScan,
      };
    }

    try {
      await this.wechaty.start();
      this.log('bot started');
      this.pendingScan = null;
    } catch (err) {
      const errMsg = `Fatal: start bot failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }
  }

  async stop() {
    this.verbose('try stop bot');

    try {
      const stopped = await this.wechaty.stop();
      this.log('bot stopped');
      return stopped;
    } catch (err) {
      const errMsg = `Fatal: stop bot failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }
  }

  async logout() {
    if (!this.isOnline()) {
      return;
    }

    this.verbose(`try logout: ${_.get(this.profile, 'id')}`);

    try {
      const loggedout = await this.wechaty.logout();
      return loggedout;
    } catch (err) {
      const errMsg = `Fatal: logout failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }
  }

  // END: basic functions

  // BEGIN: contact functions
  async extractContactInfo(contactInstance) {
    const contactId = _.get(contactInstance, 'id');
    let alias;
    try { alias = await contactInstance.alias(); } catch (err) { }

    let avatar = _.get(contactInstance, 'payload.avatar');
    if (avatar) {
      try {
        const avatarFileBox = await contactInstance.avatar();
        avatar = path.join(constants.AVATAR_DIR, `${contactId}.jpg`);
        avatarFileBox.toFile(avatar, true);
      } catch (err) {
        avatar = _.get(contactInstance, 'payload.avatar');
      }
    }

    let info = {
      id: contactId,
      wechat: _.get(contactInstance, 'payload.weixin'),
      name: contactInstance.name(),
      alias,
      gender: contactInstance.gender(),
      avatar,
      signature: _.get(contactInstance, 'payload.signature'),
      city: contactInstance.city(),
      province: contactInstance.province(),
      isFriend: contactInstance.friend(),
      type: contactInstance.type(),
    };

    const address = _.trim(_.get(contactInstance, 'payload.address'));
    if (address && address !== ',') {
      info.address = address;
    }

    if (contactInstance.self()) {
      info.self = true;
    }

    info = utils.compactObj(info);

    const myId = info.self ? contactId : _.get(this.profile, 'id');

    await this.dbModels.contact.addOrUpdateContacts(myId, info);

    return info;
  }

  async refreshContact(contact) {
    const contactInstance = _.isString(contact)
      ? this.wechaty.Contact.load(contact)
      : contact;

    try {
      await contactInstance.sync();
    } catch (err) {
      const errMsg = `refreshContact failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    return this.extractContactInfo(contactInstance);
  }

  async getContact(contactId) {
    const found = await this.dbModels.contact.findContacts(_.get(this.profile, 'id'), contactId);
    let contactInfo = _.head(found);
    if (_.isEmpty(contactInfo)) {
      contactInfo = await this.refreshContact(contactId);
    }
    return contactInfo;
  }

  parseContactInstances(contactInstances) {
    const self = this;

    return new Promise((resolve) => {
      async.map(
        contactInstances,
        async (contactInstance) => {
          const info = await self.extractContactInfo.call(self, contactInstance);

          await utils.wait(10); // added wait time to avoid wehcaty request issues

          if (_.isError(info)) {
            throw info;
          }

          return info;
        },
        (err, res) => {
          resolve(err || res);
        }
      );
    });
  }

  async refreshContactList() {
    let contactInstances = [];
    try {
      contactInstances = await this.wechaty.Contact.findAll();
    } catch (err) {
      const errMsg = `refreshContactList failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    return this.parseContactInstances(contactInstances);
  }

  async getContactList() {
    let contactList = await this.dbModels.contact.findContacts(_.get(this.profile, 'id'));
    if (_.isError(contactList) || _.isEmpty(contactList)) {
      contactList = await this.refreshContactList();
    }

    return contactList;
  }
  // END: contact functions


  // BEGIN: group functions
  async extractRoomMembers(roomInstance) {
    let members = [];
    try { members = await roomInstance.memberList(); } catch (err) { }
    if (!_.isEmpty(members)) {
      members = await this.parseContactInstances(members);
      if (_.isError(members)) {
        members = [];
      }
    }
    return members;
  }

  async extractRoomInfo(roomInstance) {
    const roomInfo = {
      id: _.get(roomInstance, 'id'),
      avatar: _.get(roomInstance, 'payload.avatar', ''),
      adminList: _.get(roomInstance, 'payload.adminIdList'),
    };

    let name;
    try { name = await roomInstance.topic(); } catch (err) { }
    if (name) {
      roomInfo.name = name; // 群名
    }

    const ownerInstance = roomInstance.owner();
    const ownerInfo = await this.extractContactInfo(ownerInstance);
    const owner = _.get(ownerInfo, 'id') || _.get(ownerInstance, 'id');
    if (owner) {
      roomInfo.owner = owner;
    }

    const members = await this.extractRoomMembers(roomInstance);
    const memberList = _.compact(_.map(members, 'id'));
    if (!_.isEmpty(memberList)) {
      roomInfo.memberList = memberList;
    }

    await this.dbModels.room.addOrUpdateRoom(_.get(this.profile, 'id'), roomInfo);

    return roomInfo;
  }

  async refreshGroup(group) {
    const roomInstance = _.isString(group)
      ? this.wechaty.Room.load(group)
      : group;

    try {
      await roomInstance.sync();
    } catch (err) {
      const errMsg = `refreshGroup failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    return this.extractRoomInfo(roomInstance);
  }

  async getGroup(groupId) {
    async function getGroupInfo() {
      const found = await this.dbModels.room.findRooms(_.get(this.profile, 'id'), groupId);
      let groupInfo = _.head(found);
      if (_.isEmpty(groupInfo)) {
        groupInfo = await this.refreshGroup(groupId);
      }

      return groupInfo;
    }

    const lock = this.lock.getLock(groupId);
    if (_.isError(lock)) {
      return lock;
    }

    return lock.acquire(
      groupId,
      _.bind(getGroupInfo, this)
    );
  }

  parseRoomInstances(roomInstances) {
    const self = this;

    return new Promise((resolve) => {
      async.map(
        roomInstances,
        async (roomInstance) => {
          const info = await self.extractRoomInfo.call(self, roomInstance);

          await utils.wait(10); // added wait time to avoid wehcaty request issues

          if (_.isError(info)) {
            throw info;
          }

          return info;
        },
        (err, res) => {
          resolve(err || res);
        }
      );
    });
  }

  async refreshGroupList() {
    let roomInstances = [];
    try {
      roomInstances = await this.wechaty.Room.findAll();
    } catch (err) {
      const errMsg = `refreshGroupList failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    return this.parseRoomInstances(roomInstances);
  }

  async getGroupList() {
    let groupList = await this.dbModels.room.findRooms(_.get(this.profile, 'id'));
    if (_.isError(groupList) || _.isEmpty(groupList)) {
      groupList = await this.refreshGroupList();
    }
    return groupList;
  }

  async kickMember(room, member) {
    if (!room || !member) {
      return new Error('invalid params');
    }
    if (_.isString(room)) {
      room = this.wechaty.Room.load(room);
    }
    if (_.isString(member)) {
      member = this.wechaty.Contact.load(member);
    }

    if (!(room instanceof wechaty.Room)
      || !(member instanceof wechaty.Contact)
    ) {
      return new Error('invalid params');
    }

    if (_.get(room.owner(), 'id') !== _.get(this.profile, 'id')) {
      return new Error('not group owner');
    }

    let kicked;
    let groupName;
    try {
      kicked = await room.del(member);
      groupName = await room.topic();
    } catch (err) {
      const errMsg = `kickMember failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    this.verbose(
      `kick member "${member.name()}"(${_.get(member, 'id')}) from "${groupName}"(${_.get(room, 'id')})`
    );

    return kicked;
  }

  async changeGroupName(room, newName) {
    if (!room || !newName) {
      return new Error('invalid params');
    }
    if (_.isString(room)) {
      room = this.wechaty.Room.load(room);
    }
    if (!(room instanceof wechaty.Room)) {
      return new Error('invalid params');
    }
    if (_.get(room.owner(), 'id') !== _.get(this.profile, 'id')) {
      return new Error('not group owner');
    }

    let changed;
    let oldName;
    try {
      oldName = await room.topic();
      changed = await room.topic(newName);
    } catch (err) {
      const errMsg = `changeGroupName failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    this.verbose(
      `group name of ${_.get(room, 'id')} changed from "${oldName}" to "${newName}"`
    );

    return changed;
  }

  initAcceptGroupInvitionQueue() {
    const self = this;

    this.joinGroupCount = 0;

    this.acceptGroupInvitionQueue = async.queue(
      async (task) => {
        const { invitation, groupName, inviterName } = task || {};
        const logStr = `group ${groupName} invitation from ${inviterName}`;
        try {
          // return undefined, don't know whether success or not
          await invitation.accept();
          self.log(`accept ${logStr}`);
          self.joinGroupCount += 1;
          await utils.wait(genJoinGroupInterval(self.joinGroupCount));
        } catch (err) {
          self.error(`accept ${logStr} failed: ${err.message}`);
        }
      },
      1
    );

    this.acceptGroupInvitionQueue.drain(
      async () => {
        self.acceptGroupInvitionQueue.pause();
        await utils.wait(genJoinGroupInterval(self.joinGroupCount));
        self.joinGroupCount = 0;
        self.acceptGroupInvitionQueue.resume();
      }
    );
  }

  // END: group functions

  // BEGIN: message functions
  async storeMessage(message) {
    return this.dbModels.message.addMessage(_.get(this.profile, 'id'), message);
  }

  async genForwardParams(messageId, msg) {
    if (_.isEmpty(msg)) {
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

    let params = parsed;
    if (_.get(msg, 'type') === constants.MessageType.MiniProgram) {
      params = {
        appid: _.get(parsed, 'accId') || constants.MINIPROGRAM_ACCID,
        title: _.get(parsed, 'title') || constants.MINIPROGRAM_TITLE,
        description: _.get(parsed, 'description', ''),
        pagePath: _.get(parsed, 'pagePath'),
        thumbUrl: _.get(parsed, 'thumbUrl'),
        thumbKey: _.get(parsed, 'thumbKey'),
      };
    }
    return params;
  }


  async sendMessage(msgParams, msgType, target, targetType) {
    if (_.isEmpty(msgParams)) {
      return new Error('invalid params');
    }

    if (_.isString(target) && !_.isEmpty(target)) {
      if (!targetType) {
        return new Error('invalid target');
      }
      if (targetType === 'room') {
        target = this.wechaty.Room.load(target);
      } else if (targetType === 'contact') {
        target = this.wechaty.Contact.load(target);
      }
    } else if ((targetType === 'room') && !(target instanceof wechaty.Room)
      || (targetType === 'contact') && !(target instanceof wechaty.Contact)
    ) {
      return new Error('invalid target');
    }

    let payload = msgParams;
    if (msgType === constants.MessageType.MiniProgram) {
      payload = new wechaty.MiniProgram(msgParams);
    } else if (msgType === constants.MessageType.Contact) {
      payload = new wechaty.Contact(msgParams);
    } else if ([
      constants.MessageType.Audio,
      constants.MessageType.Image,
      constants.MessageType.Video,
      constants.MessageType.Emoticon,
    ].includes(msgType)
    ) {
      payload = wechaty.FileBox.fromUrl(msgParams);
    }

    const RETRY = 3;
    let said;

    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < RETRY; i++) {
      try {
        said = await target.say(payload);
      } catch (err) {
        said = new Error(`sendMessage failed: ${err.message}`);
      }

      if (!_.isError(said)) {
        break;
      }

      if (i !== RETRY - 1) {
        await utils.wait(1000);
      }

      this.error(said.message);
    }
    /* eslint-disable no-await-in-loop */

    return said;
  }

  initSendGroupMessageQueue() {
    this.sendMessageCount = 0;

    const self = this;

    this.sendGroupMessageQueue = async.queue(
      (task, done) => {
        async.mapSeries(
          task.messages,
          async (message) => {
            const { params, type, groupId, callback, lastGroupMessage, lastTaskMessage } =
              message || {};
            if (_.isEmpty(params) || _.isNil(type) || !groupId) {
              return new Error('invalid params');
            }

            const sentCb = _.isFunction(callback) ? callback : _.noop;
            const sent = await self.sendMessage(params, type, groupId, 'room');
            const sentMessageId = _.get(sent, 'id');
            if (!_.isError(sent) && sentMessageId) {
              self.log(`message ${sentMessageId} sent to group ${groupId}`);
              // self.sendMessageCount += 1;
              // sentCb();
            } else {
              self.error(
                `send message to group ${groupId} failed: ${_.get(sent, 'message', 'send failed')}`
              );
              // sentCb(true);
            }
            self.sendMessageCount += 1;
            sentCb();

            if (!lastTaskMessage) {
              const interval = lastGroupMessage
                ? genSendGroupMessageInterval(self.sendMessageCount)
                : 500;

              await utils.wait(interval);
            }

            return sent;
          },
          async () => {
            if (_.isFunction(task.callback)) {
              task.callback();
            }

            if (self.sendGroupMessageQueue.length()) {
              await utils.wait(genSendGroupMessageInterval(self.sendMessageCount));
            }

            done();
          }
        );
      },
      1
    );

    this.sendGroupMessageQueue.drain(
      async () => {
        self.sendGroupMessageQueue.pause();
        await utils.wait(genSendGroupMessageInterval(self.sendMessageCount));
        self.sendMessageCount = 0;
        self.sendGroupMessageQueue.resume();
      }
    );
  }

  // END: message functions
}


module.exports = {
  Bot,
};

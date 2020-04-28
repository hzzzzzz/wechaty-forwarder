'use strict';

const _ = require('lodash');
const wechaty = require('wechaty');
const PuppetMacpro = require('wechaty-puppet-macpro').PuppetMacpro;
const async = require('async');
const fs = require('fs-extra');
const path = require('path');

const logger = require('../utils/logger');
const constants = require('../utils/constants');
const utils = require('../utils/utils');

const contactDb = require('../db/models/contact');
const messageDb = require('../db/models/message');
const roomDb = require('../db/models/room');


class MacBot {
  constructor(params) {
    this.token = _.get(params, 'token');
    this.name = _.get(params, 'name');
    this.db = _.get(params, 'db', 'wechaty');

    if (!this.token) {
      return;
    }

    this.puppet = new PuppetMacpro({ token: this.token });

    this.wechaty = wechaty.Wechaty.instance({
      puppet: this.puppet,
      name: this.name,
    });

    this.inited = false;

    // setup loggers
    this.log = _.partial(logger.log, `${this.name}`);
    this.verbose = _.partial(logger.verbose, `${this.name}`);
    this.error = _.partial(logger.error, `${this.name}`);
  }


  // BEGIN: basic functions

  isOnline() {
    return this.wechaty.logonoff();
  }

  setListener(event, listener) {
    this.verbose(`setListener: '${event}'`);

    let errMsg;
    if (!event || !_.isFunction(listener)) {
      errMsg = `setListener '${event}' failed: invalid args`;
      this.error(errMsg);
      return new Error(errMsg);
    } else if (_.includes(this.wechaty.listeners(event), listener)) {
      errMsg = `setListener '${event}' failed: listener already set`;
      this.verbose(errMsg);
      return;
    }

    this.wechaty.addListener(event, listener);
  }

  removeListener(event, listener) {
    this.verbose(`try remove listener: ${event}`)

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
    this.verbose(`Scan: status: ${status}, code: ${code}`);
  }

  async onLogin(me) {
    const myInfo = await this.extractContactInfo(me);
    if (!_.isError(myInfo)) {
      this.profile = myInfo;
    }

    this.log(`Login finished: ${_.get(this.profile, 'id')}`);
  }

  onLogout(me) {
    this.log(`Logout finished: ${_.get(this.profile, 'id')}`);
  }

  async onMessage(msg) {
    const msgData = utils.compactObj(
      {
        from: _.get(msg.from(), 'id'),
        to: _.get(msg.to(), 'id'),
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

  init(params) {
    if (this.inited) {
      return;
    }

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
        scan: _.get(params, 'onScan', this.onScan),
        login: _.get(params, 'onLogin', this.onLogin),
        logout: _.get(params, 'onLogout', this.onLogout),
        message: _.get(params, 'onMessage', this.onMessage),
      },
      (listener, event) => {
        const res = this.setListener(event, listener.bind(this));
        if (_.isError(res)) {
          this.error(`init '${event}' listener failed: ${res.message}`);
        }
      }
    );

    this.inited = true;
  }

  async start(params) {
    this.verbose('try start bot');

    let errMsg;

    const initOk = this.init(params);
    if (_.isError(initOk)) {
      errMsg = `Fatal: start bot failed: ${initOk.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }

    try {
      const started = await this.wechaty.start();
      this.log('bot started');
      return started;
    } catch (err) {
      errMsg = `Fatal: start bot failed: ${err.message}`;
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
    this.verbose(`try logout: ${_.get(this.profile, 'id')}`);

    if (!this.isOnline()) {
      return;
    }

    try {
      const loggedout = await this.wechaty.logout();
      return loggedout;
    } catch (err) {
      const errMsg = `Fatal: logout failed: ${err.message}`;
      this.error(errMsg);
      return new Error(errMsg);
    }
  }

  async terminate() {
    this.log('try terminate bot');

    await this.logout();
    return this.stop();
  }

  // END: basic functions


  // BEGIN: contact functions
  async extractContactInfo(contactInstance) {
    const contactId = _.get(contactInstance, 'id');
    let alias;
    let avatar;

    try { alias = await contactInstance.alias() } catch (err) { }
    try {
      const avatarFileBox = await contactInstance.avatar();
      avatar = path.join(constants.AVATAR_DIR, `${contactId}.jpg`);
      avatarFileBox.toFile(avatar, true);
    } catch (err) {
      avatar = _.get(contactInstance, 'payload.avatar');
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

    const address = _.get(contactInstance, 'payload.address');
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
    let errMsg;

    if (!this.wechaty instanceof wechaty.Wechaty) {
      errMsg = 'Fatal: refreshContact failed: wechaty not instantiated';
      this.error(errMsg);
      return new Error(errMsg);
    }

    const contactInstance = _.isString(contact)
      ? this.wechaty.Contact.load(contact)
      : contact;

    try {
      await contactInstance.sync();
    } catch (err) {
      errMsg = `refreshContact failed: ${err.message}`;
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
    return new Promise((resolve) => {
      async.map(
        contactInstances,
        this.extractContactInfo.bind(this),
        (err, res) => {
          resolve(err || res);
        }
      );
    });
  }

  async refreshContactList() {
    let errMsg;

    if (!this.wechaty instanceof wechaty.Wechaty) {
      errMsg = 'Fatal: fetchContactList failed: wechaty not instantiated';
      this.error(errMsg);
      return new Error(errMsg);
    }

    let contactInstances = [];
    try {
      contactInstances = await this.wechaty.Contact.findAll();
    } catch (err) {
      errMsg = `Fatal: getContactList failed: ${err.message}`;
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
    try { members = await roomInstance.memberList() } catch (err) { }
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
    try { name = await roomInstance.topic() } catch (err) { }
    if (name) {
      roomInfo.name = name; //群名
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
    let errMsg;

    if (!this.wechaty instanceof wechaty.Wechaty) {
      errMsg = 'Fatal: refreshGroup failed: wechaty not instantiated';
      this.error(errMsg);
      return new Error(errMsg);
    }

    const roomInstance = _.isString(group)
      ? this.wechaty.Room.load(group)
      : group;

    try {
      await roomInstance.sync();
    } catch (err) {
      errMsg = `refreshGroup failed: ${err.message}`;
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
    return new Promise((resolve) => {
      async.map(
        roomInstances,
        this.extractRoomInfo.bind(this),
        (err, res) => {
          resolve(err || res);
        }
      );
    });
  }

  async refreshGroupList() {
    let errMsg;
    if (!this.wechaty instanceof wechaty.Wechaty) {
      errMsg = 'Fatal: getContactList failed: wechaty not instantiated';
      this.error(errMsg);
      return new Error(errMsg);
    }

    let roomInstances = [];
    try {
      roomInstances = await this.wechaty.Room.findAll();
    } catch (err) {
      return err;
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
  // END: group functions


  // BEGIN: message functions
  async storeMessage(message) {
    return this.dbModels.message.addMessage(_.get(this.profile, 'id'), message);
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
      const { id, name, alias } = msgParams;
      if (id) {
        payload = this.wechaty.Contact.load(id);
      } else if (name || alias) {
        try {
          payload = await this.wechaty.Contact.find(utils.compactObj({ name, alias }));
        } catch (err) {
          return err;
        }
        if (!payload) {
          return new Error('contact card not found');
        }
      } else {
        return new Error('invalid params');
      }
    } else if ([
      constants.MessageType.Audio,
      constants.MessageType.Image,
      constants.MessageType.Video,
      constants.MessageType.Emoticon,
    ].includes(msgType)
    ) {
      payload = wechaty.FileBox.fromUrl(msgParams);
    }

    try {
      const said = await target.say(payload);
      return said;
    } catch (err) {
      this.error('sendMessage failed:', err.message);
      return err;
    }
  }

  // END: message functions
}


module.exports = {
  MacBot,
};

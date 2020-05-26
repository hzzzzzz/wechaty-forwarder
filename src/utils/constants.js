'use strict';

const config = require('config');
const wechatyPuppet = require('wechaty-puppet');
const _ = require('lodash');
const path = require('path');

const TIME_ZONE = 'Asia/Shanghai';

const PUBLIC_DIR = path.join(__dirname, '../../public');
const QRCODE_DIR = path.join(PUBLIC_DIR, 'qrcode');
const AVATAR_DIR = path.join(PUBLIC_DIR, 'common/avatar');

const DB_NAME = _.get(config, 'db.name', 'wechaty');

const PUPPET_TYPE = _.get(config, 'puppet.puppet', 'macPro');
const PUPPET_NAME = _.get(config, `puppet.${PUPPET_TYPE}.name`);
const PUPPET_TOKEN = _.get(config, `puppet.${PUPPET_TYPE}.token`);

const SERVER = _.get(config, 'server.addr', '127.0.0.1');
const SERVER_PORT_WEB = _.get(config, 'server.web.port');
const SERVER_PORT_WS = _.get(config, 'server.webSocket.port');

const COOKIE_KEYS = {
  clientId: 'wechaty_clientId',
};
const MINIPROGRAM_ACCID = _.get(config, 'miniProgram.accId');
const MINIPROGRAM_TITLE = '小程序';

module.exports = {
  // MessageType:
  // {
  //   Unknown: 0,
  //   Attachment: 1,
  //   Audio: 2,
  //   Contact: 3,
  //   ChatHistory: 4,
  //   Emoticon: 5,
  //   Image: 6,
  //   Text: 7,
  //   Location: 8,
  //   MiniProgram: 9,
  //   Transfer: 10,
  //   RedEnvelope: 11,
  //   Recalled: 12,
  //   Url: 13,
  //   Video: 14,
  // }
  MessageType: wechatyPuppet.MessageType,
  // ScanStatus:
  // {
  //   Unknown: 0,
  //   Cancel: 1,
  //   Waiting: 2,
  //   Scanned: 3,
  //   Confirmed: 4,
  //   Timeout: 5,
  // }
  ScanStatus: wechatyPuppet.ScanStatus,
  // ContactType:
  // {
  //   Unknown: 0,
  //   Personal: 1,
  //   Official: 2,
  // }
  ContactType: wechatyPuppet.ContactType,
  // ContactGender:
  // {
  //   Unknown: 0,
  //   Male: 1,
  //   Female: 2,
  // }
  ContactGender: wechatyPuppet.ContactGender,

  TIME_ZONE,

  PUBLIC_DIR,
  QRCODE_DIR,
  AVATAR_DIR,

  DB_NAME,

  PUPPET_TYPE,
  PUPPET_NAME,
  PUPPET_TOKEN,

  SERVER,
  SERVER_PORT_WEB,
  SERVER_PORT_WS,

  COOKIE_KEYS,

  MINIPROGRAM_ACCID,
  MINIPROGRAM_TITLE,
};

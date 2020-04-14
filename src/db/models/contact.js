'use strict';

const mongoose = require('mongoose');
const async = require('async');
const _ = require('lodash');

const constants = require('../../utils/constants');
const logger = require('../../utils/logger');

const logError = _.partial(logger.error, 'contactModel');
const logVerbose = _.partial(logger.verbose, 'contactModel');

const GENDERS = {
  Unknown: constants.ContactGender.Unknown,
  Male: constants.ContactGender.Male,
  Female: constants.ContactGender.Female,
};

const TYPES = {
  Unknown: constants.ContactType.Unknown,
  Personal: constants.ContactType.Personal,
  Official: constants.ContactType.Official,
};

const GENDERS_ENUM = _.values(GENDERS);
const TYPES_ENUM = _.values(TYPES);

const contactSchema = new mongoose.Schema(
  {
    user: String,                               // contactId of current wechat account
    id: { type: String, unique: true },         // contactId of contact
    wechat: { type: String, unique: true },
    name: String,
    alias: String,
    gender: { type: Number, enum: GENDERS_ENUM },
    avatar: String,
    signature: String,
    city: String,
    province: String,
    address: String,
    isFriend: Boolean,
    type: { type: Number, enum: TYPES_ENUM },
    self: Boolean,
  }
);

contactSchema.index({
  user: 1,
});

const DEFAULT_PROJECTION = _.chain(contactSchema)
  .get('obj')
  .transform(
    (result, value, key) => { result[key] = 1 },
    {}
  )
  .omit('user')
  .set('_id', 0)
  .value()

class Contact {
  constructor(conn) {
    if (conn) {
      if (conn instanceof mongoose.Connection) {
        this.Model = conn.model('contacts', contactSchema);
      } else {
        logError('new Contact with invalid connection, use default connection instead');
        this.Model = mongoose.model('contacts', contactSchema);
      }
    } else {
      this.Model = mongoose.model('contacts', contactSchema);
    }
  }

  async addOrUpdateContact(currentUserId, contactInfo) {
    logVerbose(
      'addOrUpdateContact, currentUser=', currentUserId, 'contactInfo=', contactInfo
    );

    if (!currentUserId) {
      return new Error('invalid currentUserId');
    }

    const contactId = _.get(contactInfo, 'id');
    if (!contactId || !_.get(contactInfo, 'wechat')) {
      return new Error('invalid contactInfo');
    }

    try {
      const updated = await this.Model.updateOne(
        { user: currentUserId, id: contactId },
        {
          $set: contactInfo,
        },
        { upsert: true },
      ).exec();
      return updated;
    } catch (err) {
      logError(`addOrUpdateContact failed: ${err.message}`);
      return err;
    }
  }

  addOrUpdateContacts(currentUserId, contactInfoArr) {
    const self = this;
    return new Promise((resolve) => {
      if (!currentUserId) {
        return resolve(new Error('invalid currentUserId'));
      }
      if (_.isEmpty(contactInfoArr)) {
        return resolve(new Error('invalid contactInfoArr'));
      }
      if (!_.isArray(contactInfoArr)) {
        contactInfoArr = [contactInfoArr];
      }

      async.each(
        contactInfoArr,
        async (contactInfo) => {
          const updated = await self.addOrUpdateContact.call(self, currentUserId, contactInfo);
          if (_.isError(updated)) {
            throw updated;
          }
          return updated;
        },
        (err, res) => {
          if (err) {
            logError(`addOrUpdateContacts failed: ${err.message}`);
          }

          resolve(err || res);
        }
      );
    });
  }

  async findContacts(currentUserId, contactIds, projection = DEFAULT_PROJECTION) {
    const condition = { user: currentUserId };
    if (!_.isEmpty(contactIds)) {
      if (!isArray(contactIds)) {
        contactIds = [contactIds];
      }
      condition.id = { $in: contactIds };
    }

    try {
      const found = await this.Model.find(condition, projection, { lean: true }).exec();
      return found;
    } catch (err) {
      logError(`findContacts failed: ${err.message}`);
      return err;
    }
  }
}

let defaultInstance;
function instance(conn) {
  if (!(conn instanceof mongoose.Connection)) {
    if (!defaultInstance) {
      defaultInstance = new Contact();
    }
    return defaultInstance;
  }

  return new Contact(conn);
}

module.exports = {
  DEFAULT_PROJECTION,

  GENDERS,
  TYPES,

  instance,
};

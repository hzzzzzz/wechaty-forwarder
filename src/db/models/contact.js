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
    users: [String],
    id: { type: String, unique: true },         // contactId of contact
    wechat: String,
    name: String,
    alias: String,
    gender: { type: Number, enum: GENDERS_ENUM },
    avatar: String,
    signature: String,
    city: String,
    province: String,
    address: String,
    isFriend: [String],                        // contactId of users
    type: { type: Number, enum: TYPES_ENUM },
    blacklisted: Boolean,
  }
);

contactSchema.index({
  users: 1,
});

contactSchema.index(
  {
    wechat: 1,
  },
  { partialFilterExpression: { wechat: { $exists: true } } }
);

const DEFAULT_PROJECTION = _.chain(contactSchema)
  .get('obj')
  .transform(
    (result, value, key) => { result[key] = 1; },
    {}
  )
  .omit('users')
  .set('_id', 0)
  .value();

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
      `addOrUpdateContact, currentUser=${currentUserId}, contactInfo=${JSON.stringify(contactInfo)}`
    );

    if (!currentUserId) {
      return new Error('contactId of current user must be specified');
    }
    const contactId = _.get(contactInfo, 'id');
    if (!contactId) {
      return new Error('invalid contactId');
    }

    const isFriend = _.get(contactInfo, 'isFriend');
    const setObj = _.omit(contactInfo, ['users', 'isFriend']);
    const addToSetObj = { users: currentUserId };
    if (isFriend) {
      addToSetObj.isFriend = currentUserId;
    }

    try {
      const updated = await this.Model.updateOne(
        { id: contactId },
        {
          $set: setObj,
          $addToSet: addToSetObj,
        },
        { upsert: true }
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
        return resolve(new Error('contactId of current user must be specified'));
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
    const condition = { users: currentUserId };
    if (!_.isEmpty(contactIds)) {
      if (!_.isArray(contactIds)) {
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

  async isBlacklisted(currentUserId, contactId) {
    let found;
    try {
      found = await this.Model.findOne(
        { users: currentUserId, id: contactId, blacklisted: true },
        DEFAULT_PROJECTION,
        { lean: true }
      ).exec();
    } catch (err) {
      logError(`check contact blacklisted failed: ${err.message}`);
    }

    return !_.isEmpty(found);
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

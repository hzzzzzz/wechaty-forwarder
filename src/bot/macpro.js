'use strict';

const _ = require('lodash');
const PuppetMacpro = require('wechaty-puppet-macpro').PuppetMacpro;

const PuppetBot = require('./base').Bot;

class Bot extends PuppetBot {
  constructor(params) {
    _.set(params, 'Puppet', _.get(params, 'Puppet', PuppetMacpro));
    super(params);
  }
}

module.exports = {
  Bot,
};

'use strict';

const _ = require('lodash');
const PuppetPadplus = require('wechaty-puppet-padplus').PuppetPadplus;

const PuppetBot = require('./base').Bot;


class Bot extends PuppetBot {
  constructor(params) {
    _.set(params, 'Puppet', _.get(params, 'Puppet', PuppetPadplus));
    super(params);
  }
}

module.exports = {
  Bot,
};

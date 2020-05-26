'use strict';

const express = require('express');

const constants = require('../../utils/constants');

function setup(router) {
  router.use('/public', express.static(constants.PUBLIC_DIR));
}

module.exports = setup;

'use strict';

const express = require('express');

const api = require('./api');
const statics = require('./statics');


const router = new express.Router();

const routes = [
  statics,
  api,
];

routes.forEach(mod => mod(router));

module.exports = router;

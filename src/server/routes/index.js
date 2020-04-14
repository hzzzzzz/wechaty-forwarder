'use strict';

const express = require('express');

const api = require('./api');


const router = new express.Router();

const routes = [
  api,
];

routes.forEach(mod => mod(router));

module.exports = router;

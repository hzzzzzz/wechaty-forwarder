'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const jsend = require('jsend');

const helper = require('./helper');
const routes = require('./routes/index');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: 'text/xml' }));

app.use(jsend.middleware);

app.use(function (req, res, next) {
  res.sendApiSuccess =
    data => res.send(helper.genApiSuccessBody(data));
  res.sendApiError =
    (errMsg, errCode) => res.send(helper.genApiErrorBody(errMsg, errCode));
  next();
});

app.use('/', routes);

module.exports = app;

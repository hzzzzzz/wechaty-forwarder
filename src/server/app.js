'use strict';

// const _ = require('lodash');
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jsend = require('jsend');
// const uuid = require('uuid').v1;

const response = require('./response');
const routes = require('./routes/index');

const app = express();

app.set('trust proxy', 'loopback');

app.use(cookieParser());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.text({ type: 'text/xml' }));

app.use(jsend.middleware);

app.use(function (req, res, next) {
  res.sendApiSuccess =
    data => res.send(response.genApiSuccessBody(data));
  res.sendApiError =
    (errMsg, errCode) => res.send(response.genApiErrorBody(errMsg, errCode));
  next();
});

// app.use(function (req, res, next) {
//   let clientId = _.get(req, `cookies.${constants.COOKIE_KEYS.clientId}`);

//   if (!clientId) {
//     clientId = uuid();

//     res.cookie(
//       constants.COOKIE_KEYS.clientId,
//       clientId,
//       { expires: new Date('9999-12-31') }
//     );
//   }

//   _.set(req, 'clientFeatures.clientId', clientId);

//   next();
// });

app.use('/', routes);

module.exports = app;

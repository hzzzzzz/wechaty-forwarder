'use strict';

const app = require('./app');
const constants = require('../utils/constants');

app.set('port', process.env.SERVER_PORT || constants.SERVER_PORT_WEB);
app.set('hostname', process.env.HOSTNAME || constants.SERVER);

/* eslint-disable no-console */
const server = app.listen(app.get('port'), app.get('hostname'), function () {
  console.log(`Express server listening on port ${server.address().port}`);
});
/* eslint-disable no-console */

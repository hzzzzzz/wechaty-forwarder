const _ = require('lodash');
const WebSocket = require('isomorphic-ws');

const response = require('./response');
const constants = require('../utils/constants');
const logger = require('../utils/logger');


// const logError = _.partial(logger.error, 'webSocket');
const log = _.partial(logger.log, 'webSocket');


let webSocket;

function startServer(token) {
  if (webSocket instanceof WebSocket.Server) {
    return;
  }

  function verifyClient(info, next) {
    const subProtocols = _.chain(info)
      .get('req.headers.sec-websocket-protocol')
      .split(',')
      .map(_.trim)
      .compact()
      .value();

    if (!_.includes(subProtocols, token)) {
      next(false);
      return;
    }

    _.some(subProtocols, (protocol) => {
      const [, clientId] = /^clientId-(.+)/.exec(protocol) || [];
      if (clientId) {
        _.set(info, 'req.clientId', clientId);
        return true;
      }
      return false;
    });

    next(true);
  }

  function onConnection(ws, req) {
    let msg = 'connection established';

    const clientId = _.get(req, 'clientId');
    if (clientId) {
      _.set(ws, 'clientId', clientId);
      msg = `${msg}, clientId: ${clientId}`;
    }

    log(msg);
  }

  webSocket = new WebSocket.Server({ port: constants.SERVER_PORT_WS, verifyClient });

  webSocket.on('connection', onConnection);
}

function broadcast(data, target) {
  if (!(webSocket instanceof WebSocket.Server)) {
    return;
  }

  webSocket.clients.forEach((client) => {
    const clientId = _.get(client, 'clientId');
    // FIXME: do not broadcast to clients without clientId
    if (target && clientId && (target !== clientId)) {
      return;
    }

    if (_.get(client, 'readyState') === WebSocket.OPEN) {
      const dataStr = _.attempt(JSON.stringify, response.genApiSuccessBody(data));
      const msgPrefix = clientId ? `broadcast to ${clientId}` : 'broadcast';
      log(`${msgPrefix}: ${dataStr}`);
      client.send(_.isError(dataStr) ? data : dataStr);
    }
  });
}


module.exports = {
  startServer,
  broadcast,
};

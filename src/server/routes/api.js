'use strict';

const _ = require('lodash');

const helper = require('../helper');
const webSocket = require('../websocket');
const logger = require('../../utils/logger');
const API_ERR_CODE = require('../errcode').API_ERR_CODE;

// const logError = _.partial(logger.error, 'api');
const log = _.partial(logger.log, 'api');

function setup(router) {
  webSocket.startServer(helper.token);

  router.get('/api/token', async (req, res) => {
    res.status(200).sendApiSuccess({ token: helper.token });
  });

  router.post('/api/start', async (req, res) => {
    const clientId = _.get(req, 'clientFeatures.clientId');

    const started = await helper.botOnline(clientId);
    if (_.isError(started)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalError
      );
    }
    log('start bot');
    res.status(200).sendApiSuccess();
  });

  router.post('/api/logout', async (req, res) => {
    const logoutOk = await helper.botLogout();
    if (_.isError(logoutOk)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalError
      );
    }
    res.status(200).sendApiSuccess();
  });

  router.get('/api/group', async (req, res) => {
    const groups = await helper.findGroups(
      {},
      {
        id: 1,
        avatar: 1,
        name: 1,
      }
    );

    if (_.isError(groups)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalError
      );
    }

    res.status(200).sendApiSuccess(groups);
  });

  router.get('/api/group/member', async (req, res) => {
    const groupId = _.get(req, 'query.id');

    const members = await helper.findGroupMembers(groupId);

    if (_.isError(members)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalError
      );
    }

    res.status(200).sendApiSuccess(members);
  });

  router.get('/api/message', async (req, res) => {
    const from = _.get(req, 'query.from');
    const limit = _.toNumber(_.get(req, 'query.limit')) || 20;

    const messages = await helper.findMessages(from, limit);
    if (_.isError(messages)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalErr
      );
    }
    res.status(200).sendApiSuccess(messages);
  });

  router.post('/api/message/forward', async (req, res) => {
    const msgId = _.get(req, 'body.msgId');
    const groupId = _.get(req, 'body.groupId');
    const clientId = _.get(req, 'clientFeatures.clientId');

    if (_.isEmpty(msgId) || _.isEmpty(groupId)) {
      return res.status(400).sendApiError(
        'invalid query',
        API_ERR_CODE.badReq
      );
    }
    const taskId = await helper.queueForwards(msgId, groupId, clientId);

    if (_.isError(taskId)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalErr
      );
    }
    res.status(200).sendApiSuccess({ taskId });
  });

  router.post('/api/contact/refresh', async (req, res) => {
    const id = _.get(req, 'body.id');

    if (_.isEmpty(id)) {
      return res.status(400).sendApiError(
        'invalid query',
        API_ERR_CODE.badReq
      );
    }

    const refreshed = await helper.refreshContact(id);

    if (_.isError(refreshed)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalErr
      );
    }

    res.status(200).sendApiSuccess();
  });

  router.post('/api/group/refresh', async (req, res) => {
    const id = _.get(req, 'body.id');

    if (_.isEmpty(id)) {
      return res.status(400).sendApiError(
        'invalid query',
        API_ERR_CODE.badReq
      );
    }

    const refreshed = await helper.refreshGroup(id);
    if (_.isError(refreshed)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalErr
      );
    }

    res.status(200).sendApiSuccess();
  });
}

module.exports = setup;

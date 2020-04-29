'use strict';

const _ = require('lodash');

const helper = require('../helper');
const API_ERR_CODE = require('../errcode').API_ERR_CODE;


function setup(router) {
  helper.startWebSocketServer();

  router.post('/api/start', async (req, res) => {
    const started = await helper.botOnline();
    if (_.isError(started)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalError
      );
    }
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

  router.get('/api/message', async (req, res) => {
    const from = _.get(req, 'query.from');
    const limit = _.toNumber(_.get(req, 'query.limit')) || 10;

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
    const msgId = _.get(req, 'query.msgId');
    const groupId = _.get(req, 'query.groupId');

    if (_.isEmpty(msgId) || _.isEmpty(groupId)) {
      return res.status(400).sendApiError(
        'invalid query',
        API_ERR_CODE.badReq
      );
    }
    const queued = await helper.queueForwards(msgId, groupId);

    if (_.isError(queued)) {
      return res.status(500).sendApiError(
        'internal error',
        API_ERR_CODE.internalErr
      );
    }
    res.status(200).sendApiSuccess();
  });
}

module.exports = setup;

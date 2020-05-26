'use strict';

const _ = require('lodash');

/**
 * generate success response body for API call
 *
 * samples:
 *
 *   input: { foo: 'this is content' }
 *   output: { data: { foo: 'this is content' } }
 *
 *   input: 'this is a message'
 *   output: { data: 'this is a message' }
 */
function genApiSuccessBody(content) {
  return { data: content || {} };
}

/**
 * generate error response body for API call
 *
 * samples:
 *
 *   input: 'this is error message'
 *   output: { error: { message: 'this is error message' } }
 *
 *   input: new Error('some error')
 *   output: { error: { message: 'some error' } }
 *
 * you can also specify an error code in second param
 */
function genApiErrorBody(errMsg, errCode) {
  errMsg = _.isError(errMsg) ? _.get(errMsg, 'message') : errMsg;
  errMsg = errMsg || 'Error';

  const errDetail = {
    message: errMsg,
  };
  if (errCode) {
    errDetail.code = errCode;
  }

  return { error: errDetail };
}

module.exports = {
  genApiSuccessBody,
  genApiErrorBody,
};

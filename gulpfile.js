'use strict';

const gulp = require('gulp');
const eslint = require('gulp-eslint');
const airbnb = require('eslint-config-airbnb-base');

const LINT_RULES = {
  baseConfig: airbnb,
  rules: {
    strict: 'off',
    'no-console': 'error',
    'object-shorthand': 'off',
    'prefer-arrow-callback': 'off',
    'no-param-reassign': 'off',
    'func-names': 'off',
    camelcase: 'off',
    'consistent-return': 'off',
    'prefer-rest-params': 'off',
    'no-restricted-syntax': 'warn',
    'one-var': 'off',
    indent: [
      'error',
      2,
      {
        SwitchCase: 1,
        VariableDeclarator: { var: 2, let: 2, const: 3 },
        CallExpression: { arguments: 'first' },
        MemberExpression: 'off',
        ignoredNodes: ['ConditionalExpression'],
      },
    ],
    'import/no-extraneous-dependencies': 'off',
    'no-mixed-operators': 'off',
    'no-plusplus': 'off',
    'comma-dangle': [
      'error',
      {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'never',
      },
    ],
    'no-unused-expressions': [
      'error',
      {
        allowShortCircuit: true,
        allowTernary: false,
        allowTaggedTemplates: false,
      },
    ],
    radix: ['error', 'as-needed'],
    'no-return-assign': ['error', 'except-parens'],
    'no-useless-escape': 'off',
    'no-underscore-dangle': [
      'error',
      { allow: ['_id'] },
    ],
    'function-paren-newline': 'off',
    'prefer-destructuring': 'off',
    'no-multi-spaces': ['error', { ignoreEOLComments: true }],
    'object-curly-newline': ['error', { consistent: true }],
    'no-restricted-globals': 'off',
    'no-buffer-constructor': 'off',
    'no-async-promise-executor': 'off',
    'arrow-parens': [
      'error',
      'as-needed',
      { requireForBlockBody: true },
    ],
    'operator-linebreak': [
      'error',
      'after',
      {
        overrides: {
          '?': 'before',
          ':': 'before',
          '||': 'before',
          '&&': 'before',
        },
      },
    ],
    'no-empty': [
      'error',
      { allowEmptyCatch: true },
    ],
  },
  envs: ['es6', 'node'],
  parserOptions: { ecmaVersion: 2017 },
};


function lintJS() {
  return gulp
    .src(['src/**/*.js', '*.js'])
    .pipe(eslint(LINT_RULES))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
}

module.exports = {
  lint: lintJS,
};

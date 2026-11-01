/**
 * ESLint flat config (ESLint 9+, CommonJS project).
 *
 * Browser files in `client/` are linted as scripts (no CommonJS globals),
 * server files as CommonJS Node scripts.
 */

'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'plan/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['server.js', 'src/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
    },
  },
  {
    files: ['client/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
  },
  {
    // Reconnect is defined in client/reconnect.js (loaded before client.js).
    files: ['client/client.js'],
    languageOptions: {
      globals: { Reconnect: 'readonly' },
    },
  },
  {
    // client/reconnect.js is a dual-environment module: a classic browser
    // script and a CommonJS module for Node tests — needs the `module` global.
    files: ['client/reconnect.js'],
    languageOptions: {
      globals: { module: 'writable' },
    },
  },
];

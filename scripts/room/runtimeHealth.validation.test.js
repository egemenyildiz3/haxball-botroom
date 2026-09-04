const assert = require('node:assert/strict');
const test = require('node:test');

const { isHeadlessRoomLostError } = require('./runtimeHealth');

test('node-haxball null room hatası fatal oda kaybı olarak tanınır', () => {
  const err = new TypeError("Cannot read properties of null (reading 'getPlayer')");
  err.stack = [
    "TypeError: Cannot read properties of null (reading 'getPlayer')",
    '    at Object.getPlayer (/usr/src/app/node_modules/node-haxball/src/headlessWrapper.js:118:46)',
  ].join('\n');

  assert.equal(isHeadlessRoomLostError(err), true);
});

test('genel TypeError fatal oda kaybı sayılmaz', () => {
  const err = new TypeError("Cannot read properties of null (reading 'getPlayer')");
  err.stack = 'TypeError: somewhere else';

  assert.equal(isHeadlessRoomLostError(err), false);
});

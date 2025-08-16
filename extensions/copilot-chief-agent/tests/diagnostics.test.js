/* eslint-env jest */
const { initDiagnostics, logDiag } = require('../src/diagnostics');
const path = require('path');

describe('diagnostics basic', () => {
  const root = path.join(__dirname, '..');
  test('init and logDiag callable', () => {
    expect(() => initDiagnostics(root)).not.toThrow();
    expect(() => logDiag('test.event', { a: 1 })).not.toThrow();
  });
});

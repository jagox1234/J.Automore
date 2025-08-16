// Force read errors to exercise catch paths
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanProject } = require('../src/projectScanner');

test('projectScanner skips unreadable files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scanerr-'));
  const file = path.join(root, 'x.js');
  fs.writeFileSync(file, 'console.log(1)');
  // Make read throw
  jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('boom'); });
  const out = scanProject(root, ['.js']);
  expect(out).toBe('');
});

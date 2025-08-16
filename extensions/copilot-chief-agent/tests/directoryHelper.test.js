const fs = require('fs');
const os = require('os');
const path = require('path');
const { listDirectories } = require('../src/directoryHelper');

function makeTree(){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dirs-'));
  fs.mkdirSync(path.join(root,'one'));
  fs.mkdirSync(path.join(root,'one','sub'));
  fs.mkdirSync(path.join(root,'two'));
  fs.mkdirSync(path.join(root,'node_modules'));
  return root;
}

test('listDirectories respects depth and ignores node_modules', () => {
  const root = makeTree();
  const dirs = listDirectories(root, 0); // only top-level directories
  const rels = dirs.map(d=>d.rel).sort();
  expect(rels).toContain('one');
  expect(rels).toContain('two');
  expect(rels.some(r=>r.includes('node_modules'))).toBe(false);
  expect(rels.some(r=>r.includes('sub'))).toBe(false); // depth limited
});

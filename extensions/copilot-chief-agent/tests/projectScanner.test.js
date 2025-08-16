const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanProject } = require('../src/projectScanner');

describe('projectScanner', () => {
  test('includes small file and truncates very large file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
    const small = path.join(tmp, 'a.js');
    fs.writeFileSync(small, 'console.log("small");');
    const large = path.join(tmp, 'big.js');
    // Create >70k byte file to exceed WHOLE_FILE_LIMIT (60k)
    const bigContent = 'x'.repeat(70_000);
    fs.writeFileSync(large, bigContent);
    const out = scanProject(tmp, ['.js']);
    expect(out).toMatch(/a.js/);
    expect(out).toMatch(/big.js/);
    expect(out).toMatch(/FILE TRUNCATED/);
  });
});

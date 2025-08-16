const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMemory, saveMemory, memoryPath } = require('../src/memoryManager');

function tmpDir(){ return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')); }

describe('memoryManager', () => {
  test('saves and loads new format', () => {
    const root = tmpDir();
    const data = { steps: [{ title: 'a'}] };
    saveMemory(root, data);
    const loaded = loadMemory(root);
    expect(loaded).toEqual(data);
    expect(fs.existsSync(memoryPath(root))).toBe(true);
  });

  test('migrates legacy file', () => {
    const root = tmpDir();
    const legacy = path.join(root, '.copilot-chief-memory.json');
    fs.writeFileSync(legacy, JSON.stringify({ legacy: true }), 'utf8');
    const loaded = loadMemory(root);
    expect(loaded).toEqual({ legacy: true });
    expect(fs.existsSync(memoryPath(root))).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false); // removed after migration
  });
});

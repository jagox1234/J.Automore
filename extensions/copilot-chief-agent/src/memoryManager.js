const fs = require('fs'); // trigger workflow
const path = require('path');

function memoryPath(root) {
  return path.join(root, '.copilot-chief-memory.json');
}

function loadMemory(root) {
  const p = memoryPath(root);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveMemory(root, data) {
  const p = memoryPath(root);
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

module.exports = { loadMemory, saveMemory };

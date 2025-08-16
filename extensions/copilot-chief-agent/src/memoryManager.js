const fs = require('fs'); // trigger workflow
const path = require('path');

const LEGACY_FILE = '.copilot-chief-memory.json';
const DIR = '.copilot-chief';
const STATE_FILE = 'state.json';

function memoryDir(root){ return path.join(root, DIR); }
function memoryPath(root){ return path.join(memoryDir(root), STATE_FILE); }
function legacyPath(root){ return path.join(root, LEGACY_FILE); }

function loadMemory(root){
  // Prefer new path
  const newP = memoryPath(root);
  if (fs.existsSync(newP)) {
    try { return JSON.parse(fs.readFileSync(newP,'utf8')); } catch { return {}; }
  }
  // Fallback: legacy file then migrate
  const oldP = legacyPath(root);
  if (fs.existsSync(oldP)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(oldP,'utf8'));
      // Migrate
      saveMemory(root, parsed);
      try { fs.unlinkSync(oldP); } catch {}
      return parsed;
    } catch { return {}; }
  }
  return {};
}

function saveMemory(root, data){
  try {
    const dir = memoryDir(root);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(memoryPath(root), JSON.stringify(data, null, 2),'utf8');
  } catch {}
}

module.exports = { loadMemory, saveMemory, memoryPath };

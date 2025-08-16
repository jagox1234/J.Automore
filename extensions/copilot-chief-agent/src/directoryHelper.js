const fs = require('fs');
const path = require('path');

function listDirectories(root, maxDepth = 2) {
  const results = [];
  function walk(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (['.git','node_modules','dist','build','.vscode','coverage','.idea'].includes(e.name)) continue;
      const full = path.join(current, e.name);
      const rel = path.relative(root, full) || '.';
      results.push({ path: full, rel, depth });
      walk(full, depth + 1);
    }
  }
  walk(root, 0);
  return results;
}

module.exports = { listDirectories };

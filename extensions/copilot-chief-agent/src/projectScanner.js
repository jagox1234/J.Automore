const fs = require('fs');
const path = require('path');

function scanProject(dir, exts = ['.js', '.ts', '.jsx', '.tsx', '.json']) {
  let results = '';
  try {
    const entries = fs.readdirSync(dir);
    for (const file of entries) {
      if (file.startsWith('.') && file !== '.env') continue; // skip hidden heavy dirs
      const filePath = path.join(dir, file);
      let stat;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (stat.isDirectory()) {
        if (['node_modules', 'dist', 'build', '.git', '.vscode'].includes(file)) continue;
        results += scanProject(filePath, exts);
      } else if (exts.includes(path.extname(file)) && stat.size < 60_000) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          results += `\n[${path.relative(process.cwd(), filePath)}]\n${content}`;
        } catch {}
      }
    }
  } catch {}
  return results.slice(0, 200_000); // cap size
}

module.exports = { scanProject };

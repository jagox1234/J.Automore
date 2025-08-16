const fs = require('fs');
const path = require('path');

// Max bytes to read whole file, else we sample head+tail
const WHOLE_FILE_LIMIT = 60_000;
const TOTAL_CAP = 200_000;

function scanProject(dir, exts = ['.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml']) {
  let out = [];
  traverse(dir, exts, out);
  const joined = out.join('');
  return joined.slice(0, TOTAL_CAP);
}

function traverse(dir, exts, out){
  let totalLen = out.reduce((a,s)=>a+s.length,0);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const file of entries) {
    if (file.startsWith('.') && file !== '.env') continue;
    if (['node_modules','dist','build','.git','.vscode','.idea','coverage'].includes(file)) continue;
    const filePath = path.join(dir, file);
    let stat; try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.isDirectory()) { traverse(filePath, exts, out); continue; }
    const ext = path.extname(file);
    if (!exts.includes(ext)) continue;
    if (stat.size <= WHOLE_FILE_LIMIT) {
  try { const chunk = `\n[${path.relative(process.cwd(), filePath)}]\n${fs.readFileSync(filePath,'utf8')}`; out.push(chunk); totalLen += chunk.length; } catch { /* read small file failed */ }
    } else {
      // Large file: sample first 120 lines and last 40 lines
      try {
        const content = fs.readFileSync(filePath,'utf8');
        const lines = content.split(/\r?\n/);
        const head = lines.slice(0,120).join('\n');
        const tail = lines.slice(-40).join('\n');
        const chunk = `\n[${path.relative(process.cwd(), filePath)}]\n/* FILE TRUNCATED size=${stat.size} */\n${head}\n...\n${tail}`;
        out.push(chunk); totalLen += chunk.length;
  } catch { /* read large file failed */ }
    }
    // Stop early if near cap
    if (totalLen > TOTAL_CAP) return;
  }
}

module.exports = { scanProject };

import fs from 'fs';
import path from 'path';

const DEFAULT_EXTS = ['.js', '.jsx', '.ts', '.tsx'];

function getAllCodeFiles(dir: string, exts = DEFAULT_EXTS, results: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return results; }
  for (const file of entries) {
    const filePath = path.join(dir, file);
    let stat;
    try { stat = fs.statSync(filePath); } catch { continue; }
    if (stat.isDirectory()) {
      if (file.startsWith('.') || file === 'node_modules' || file === 'dist' || file === 'build') continue;
      getAllCodeFiles(filePath, exts, results);
    } else if (exts.includes(path.extname(file))) {
      results.push(filePath);
    }
  }
  return results;
}

export interface ProjectIndexOptions { maxBytes?: number; }

export function indexProject(rootPath: string, opts: ProjectIndexOptions = {}): string {
  const files = getAllCodeFiles(rootPath);
  const maxBytes = opts.maxBytes ?? 200_000;
  let used = 0;
  let summary = '';
  for (const file of files.sort()) {
    if (used > maxBytes) break;
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!content.trim()) continue;
    const slice = content.slice(0, Math.max(0, maxBytes - used));
    used += Buffer.byteLength(slice, 'utf8');
    summary += `\n[${path.relative(rootPath, file)}]\n${slice}\n`;
  }
  return summary.trim();
}

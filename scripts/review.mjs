import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import simpleGit from 'simple-git';
import OpenAI from 'openai';

const git = simpleGit();
const CONFIG_PATH = path.resolve('copilot-review.config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      includePatterns: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
      excludePatterns: ['node_modules/**', 'dist/**', 'build/**'],
      maxFileSizeKB: 200,
      useDiff: true,
      maxIssuesPerFile: 12,
  output: { json: 'review.json', markdown: 'review.md', patch: 'review.patch' },
  cacheFile: '.ai/review-cache.json',
  generatePatchDiff: true
    };
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// Simple glob -> regex converter (supports ** and *)
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\\]\\]/g, r => `\\${r}`)
    .replace(/\\\*\\\*/g, '§§DOUBLESTAR§§')
    .replace(/\\\*/g, '[^/]*')
    .replace(/§§DOUBLESTAR§§/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function buildMatchers(patterns) {
  return patterns.map(p => globToRegex(p));
}

function matches(file, includes, excludes) {
  const inc = includes.some(r => r.test(file));
  if (!inc) return false;
  if (excludes.some(r => r.test(file))) return false;
  return true;
}

async function getChangedFiles() {
  try {
    const diffSummary = await git.diff(['--name-only', 'HEAD~1']);
    return diffSummary.split('\n').filter(f => f.trim());
  } catch {
    const status = await git.status();
    return [...status.modified, ...status.created];
  }
}

async function getDiffPatch(file) {
  try {
    const patch = await git.diff(['--unified=0', 'HEAD~1', '--', file]);
    return patch;
  } catch {
    return '';
  }
}

function fileSizeKB(file) {
  try {
    return fs.statSync(file).size / 1024;
  } catch { return Infinity; }
}

function buildPrompt({ file, code, diff, useDiff, maxIssues }) {
  const mode = useDiff && diff ? 'DIFF MODE' : 'FULL FILE MODE';
  const snippet = useDiff && diff ? diff : code;
  return `Eres un revisor de código senior. Analiza el ${mode} del archivo y genera hasta ${maxIssues} issues claros.
Devuelve SOLO un JSON con esta estructura exacta (sin texto adicional):\n\n{
  "file": "${file}",
  "issues": [
    {
      "line": <numero o null>,
      "issue": "descripcion corta (<=120 chars)",
      "copilotPrompt": "Prompt imperativo concreto para que Copilot aplique el cambio"
    }
  ]
}\n\nReglas:\n- Usa número de línea relativo al archivo final (si solo diff, usa los +lines).\n- No inventes cambios triviales.\n- No incluyas markdown ni comentarios fuera del JSON.\n
=== START ${mode} (${file}) ===\n${snippet}\n=== END ===`;
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function generatePatch(openai, file, code, issues) {
  if (!issues.length) return '';
  const issuesList = issues.map((i, idx) => `${idx + 1}. Línea ${i.line ?? 'N/A'} - ${i.issue}`).join('\n');
  const prompt = `Genera un diff unificado (formato git) MODIFICANDO SOLO lo necesario para resolver estos issues en ${file}. No reescribas partes sin cambios. Devuelve SOLO el diff.\nIssues:\n${issuesList}\n\nArchivo original:\n\n${code}`;
  const res = await openai.responses.create({
    model: 'gpt-4o-mini',
    input: prompt,
    temperature: 0.1
  });
  const out = res.output_text || '';
  // Heuristic: keep only lines starting with diff header or @@ or + - space
  const match = out.match(/diff --git[\s\S]*/);
  return match ? match[0].trim() : out.trim();
}

async function reviewFile(cfg, openai, file, cache) {
  const sizeOK = fileSizeKB(file) <= cfg.maxFileSizeKB;
  if (!sizeOK) {
    return { file, issues: [{ line: null, issue: 'Archivo demasiado grande, omitido (> maxFileSizeKB)', copilotPrompt: 'Dividir el archivo o reducir tamaño antes de nueva revisión.' }] };
  }
  let code = '';
  try { code = fs.readFileSync(file, 'utf8'); } catch { /* ignore */ }
  const contentHash = hashContent(code);
  const cached = cache[file];
  if (cached && cached.hash === contentHash) {
    return { ...cached.result, _fromCache: true };
  }
  const diff = cfg.useDiff ? await getDiffPatch(file) : '';
  const prompt = buildPrompt({ file, code, diff, useDiff: cfg.useDiff, maxIssues: cfg.maxIssuesPerFile });
  const res = await openai.responses.create({
    model: cfg.model,
    input: prompt,
    temperature: cfg.temperature
  });
  const raw = res.output_text || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }
  if (!parsed || !Array.isArray(parsed.issues)) {
    parsed = { file, issues: [{ line: null, issue: 'No se pudo parsear respuesta', copilotPrompt: 'Reintentar revisión con prompt ajustado.' }] };
  }
  parsed.file = file;
  parsed.issues = parsed.issues.map(it => ({
    line: typeof it.line === 'number' ? it.line : null,
    issue: String(it.issue || '').slice(0, 180),
    copilotPrompt: String(it.copilotPrompt || '').slice(0, 500)
  })).slice(0, cfg.maxIssuesPerFile);
  const result = parsed;
  cache[file] = { hash: contentHash, result };
  return result;
}

function toMarkdown(reports) {
  if (!reports.length) return 'No hay cambios relevantes para revisar.';
  let out = '# Revisión AI (Copilot Ready)\n';
  for (const r of reports) {
    out += `\n## ${r.file}\n`;
    for (const issue of r.issues) {
      out += `- Línea ${issue.line ?? 'N/A'}: ${issue.issue}\n`;
    }
    out += `\n**Prompts Copilot:**\n`;
    for (const issue of r.issues) {
      out += `\n"""\n${issue.copilotPrompt}\n"""\n`;
    }
  }
  return out;
}

async function main() {
  const cfg = loadConfig();
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY no presente: se omite la revisión AI (exit 0)');
    // Crear artefactos vacíos esperados para no romper pasos posteriores
    const empty = '[]';
    try { fs.writeFileSync('review.json', empty); } catch {}
    try { fs.writeFileSync('review.md', 'Revisión omitida: falta OPENAI_API_KEY'); } catch {}
    return; // exit 0
  }
  const includes = buildMatchers(cfg.includePatterns || []);
  const excludes = buildMatchers(cfg.excludePatterns || []);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const cacheFile = cfg.cacheFile || '.ai/review-cache.json';
  let cache = {};
  if (fs.existsSync(cacheFile)) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; }
  }
  const changed = await getChangedFiles();
  const target = changed.filter(f => matches(f, includes, excludes));
  if (!target.length) {
    fs.writeFileSync(cfg.output.json, '[]');
    fs.writeFileSync(cfg.output.markdown, 'No hay cambios relevantes para revisar.');
    console.log('Sin archivos para revisar.');
    return;
  }
  const reports = [];
  const patchSegments = [];
  for (const file of target) {
    try {
      console.error('Revisando', file);
      const r = await reviewFile(cfg, openai, file, cache);
      reports.push(r);
      if (cfg.generatePatchDiff && !r._fromCache && process.env.GENERATE_PATCH === '1') {
        const code = fs.readFileSync(file, 'utf8');
        const patch = await generatePatch(openai, file, code, r.issues);
        if (patch) patchSegments.push(patch);
      }
    } catch (e) {
      reports.push({ file, issues: [{ line: null, issue: 'Error en revisión: ' + e.message, copilotPrompt: 'Revisar manualmente el archivo.' }] });
    }
  }
  fs.writeFileSync(cfg.output.json, JSON.stringify(reports, null, 2));
  fs.writeFileSync(cfg.output.markdown, toMarkdown(reports));
  if (patchSegments.length) {
    ensureDir(cfg.output.patch);
    fs.writeFileSync(cfg.output.patch, patchSegments.join('\n\n'));
  }
  ensureDir(cacheFile);
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  console.log('Revisión completada.');
}

main().catch(e => { console.error(e); process.exit(1); });

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
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
      output: { json: 'review.json', markdown: 'review.md' }
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

async function reviewFile(cfg, openai, file) {
  const sizeOK = fileSizeKB(file) <= cfg.maxFileSizeKB;
  if (!sizeOK) {
    return { file, issues: [{ line: null, issue: 'Archivo demasiado grande, omitido (> maxFileSizeKB)', copilotPrompt: 'Dividir el archivo o reducir tamaño antes de nueva revisión.' }] };
  }
  let code = '';
  try { code = fs.readFileSync(file, 'utf8'); } catch { /* ignore */ }
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
  return parsed;
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
    console.error('Falta OPENAI_API_KEY');
    process.exit(1);
  }
  const includes = buildMatchers(cfg.includePatterns || []);
  const excludes = buildMatchers(cfg.excludePatterns || []);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const changed = await getChangedFiles();
  const target = changed.filter(f => matches(f, includes, excludes));
  if (!target.length) {
    fs.writeFileSync(cfg.output.json, '[]');
    fs.writeFileSync(cfg.output.markdown, 'No hay cambios relevantes para revisar.');
    console.log('Sin archivos para revisar.');
    return;
  }
  const reports = [];
  for (const file of target) {
    try {
      console.error('Revisando', file);
      reports.push(await reviewFile(cfg, openai, file));
    } catch (e) {
      reports.push({ file, issues: [{ line: null, issue: 'Error en revisión: ' + e.message, copilotPrompt: 'Revisar manualmente el archivo.' }] });
    }
  }
  fs.writeFileSync(cfg.output.json, JSON.stringify(reports, null, 2));
  fs.writeFileSync(cfg.output.markdown, toMarkdown(reports));
  console.log('Revisión completada.');
}

main().catch(e => { console.error(e); process.exit(1); });

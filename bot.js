import 'dotenv/config';
import OpenAI from 'openai';
import fetch from 'node-fetch';

// Basic env validation (GITHUB_TOKEN optional for unauthenticated low-rate access)
const requiredEnv = ['OPENAI_API_KEY', 'GITHUB_REPO'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Create a .env file (see .env.example) and try again.');
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.warn('[WARN] GITHUB_TOKEN no establecido: se usará acceso anónimo (límite de rate bajo y sin acceso a repos privados).');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const repo = process.env.GITHUB_REPO; // format: owner/name
const token = process.env.GITHUB_TOKEN; // PAT local o GITHUB_TOKEN en Actions (opcional)

// Helper: GitHub API base
const GH_API = 'https://api.github.com';

async function readFile(path) {
  const url = `${GH_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'j-automore-bot'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.content) throw new Error('Unexpected response: no content field');
  return Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
}

async function askChatGPT(code, filePath) {
  const prompt = `Analiza el siguiente archivo (${filePath}) y genera una lista clara y priorizada de instrucciones concretas para que GitHub Copilot mejore el código. Incluye:\n- Refactorizaciones sugeridas (con justificación breve)\n- Posibles bugs o edge cases\n- Mejores prácticas (rendimiento, seguridad, legibilidad)\n- Tests recomendados\nEntrega la respuesta en español en formato de lista numerada breve y accionable.\n\n=== CODE START (${filePath}) ===\n${code}\n=== CODE END ===`;
  const res = await openai.responses.create({
    model: 'gpt-4o-mini',
    input: prompt,
    temperature: 0.3
  });
  return res.output_text || '[Sin texto devuelto]';
}

function parseArgs() {
  const [, , ...rest] = process.argv;
  const opts = { file: 'App.js' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if ((a === '-f' || a === '--file') && rest[i + 1]) {
      opts.file = rest[++i];
    }
  }
  return opts;
}

async function main() {
  const { file } = parseArgs();
  console.error(`Leyendo archivo remoto: ${file} de ${repo}`);
  try {
    const code = await readFile(file);
    console.error('Archivo leído. Solicitando análisis a OpenAI...');
    const instrucciones = await askChatGPT(code, file);
    console.log('\n=== Instrucciones para Copilot ===\n');
    console.log(instrucciones.trim());
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

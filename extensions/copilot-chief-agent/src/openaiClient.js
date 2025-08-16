// openai client wrapper improved error handling (ci touch)
const vscode = require('vscode');
const { getApiKey } = require('./apiKeyStore');
const globalAny = global;
if (typeof globalAny.fetch !== 'function') {
  // Lazy load node-fetch if not present (when running in extension host without built-in fetch)
  try { globalAny.fetch = require('node-fetch'); } catch { /* ignore */ }
}

/**
 * Simple ChatGPT wrapper using fetch to avoid ESM/CJS issues with official SDK.
 */
async function askChatGPT(prompt, opts={}) {
  const config = vscode.workspace.getConfiguration('copilotChief');
  if (process.env.JEST_WORKER_ID) {
    return 'TEST_RESPONSE';
  }
  const key = await getApiKey();
  if (!key) {
    vscode.window.showWarningMessage('OpenAI API key no encontrada. Configura una para respuestas inteligentes.');
    return '';
  }
  const model = opts.model || config.get('model') || 'gpt-4o-mini';
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.4;
  const max_tokens = opts.max_tokens || 600;
  const body = {
    model,
    messages: [ { role: 'user', content: prompt } ],
    temperature,
    max_tokens
  };
  const started = Date.now();
  try {
  const controller = new AbortController();
  const defaultMs = parseInt(process.env.COPILOT_CHIEF_TEST_TIMEOUT || '20000',10);
  const to = setTimeout(()=>controller.abort(), (opts.timeoutMs||defaultMs));
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(to);
    const latency = Date.now() - started;
    if (!res.ok) {
      const txt = await safeText(res, 400);
      const msg = `OpenAI HTTP ${res.status} (${latency}ms): ${txt}`;
      vscode.window.showWarningMessage(msg);
      return '';
    }
    const json = await res.json();
    const content = (json.choices?.[0]?.message?.content || '').trim();
    if (!content) vscode.window.showWarningMessage('Respuesta vacía del modelo.');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') {
      vscode.window.showErrorMessage('Timeout consultando OpenAI (abortado).');
    } else {
      vscode.window.showErrorMessage('Error OpenAI: ' + (e.message || e.toString()));
    }
    return '';
  }
}

async function safeText(res, limit){
  try { return (await res.text()).slice(0, limit); } catch { return '<<no body>>'; }
}

module.exports = { askChatGPT };

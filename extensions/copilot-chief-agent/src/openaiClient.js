const vscode = require('vscode');
const globalAny = global;
if (typeof globalAny.fetch !== 'function') {
  // Lazy load node-fetch if not present (when running in extension host without built-in fetch)
  try { globalAny.fetch = require('node-fetch'); } catch(_) {}
}

/**
 * Simple ChatGPT wrapper using fetch to avoid ESM/CJS issues with official SDK.
 */
async function askChatGPT(prompt) {
  const config = vscode.workspace.getConfiguration('copilotChief');
  const key = process.env.OPENAI_API_KEY || config.get('openaiApiKey');
  if (!key) {
    vscode.window.showWarningMessage('OpenAI API key no encontrada (OPENAI_API_KEY env o copilotChief.openaiApiKey).');
    return '';
  }
  const model = config.get('model') || 'gpt-4o-mini';
  const body = {
    model,
    messages: [ { role: 'user', content: prompt } ],
    temperature: 0.4,
    max_tokens: 600
  };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0,200)}`);
    }
    const json = await res.json();
    return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '').trim();
  } catch (e) {
    vscode.window.showErrorMessage('Error OpenAI: ' + (e.message || e.toString()));
    return '';
  }
}

module.exports = { askChatGPT };

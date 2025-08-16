const vscode = require('vscode');
let ctx = null;

function init(context) { ctx = context; }

async function getApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  if (ctx) {
    try {
      const sec = await ctx.secrets.get('copilotChief.openaiApiKey');
      if (sec) return sec.trim();
  } catch { /* secret retrieval failed */ }
  }
  const cfg = vscode.workspace.getConfiguration('copilotChief');
  const cfgKey = cfg.get('openaiApiKey');
  if (cfgKey) return (''+cfgKey).trim();
  return '';
}

async function setApiKey(value) {
  if (!ctx) throw new Error('Contexto no inicializado');
  if (!value) { await ctx.secrets.delete('copilotChief.openaiApiKey'); return; }
  await ctx.secrets.store('copilotChief.openaiApiKey', value.trim());
}

module.exports = { init, getApiKey, setApiKey };

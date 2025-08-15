const vscode = require('vscode');
const OpenAI = require('openai');
let client;

function getClient() {
  if (!client) {
    const key = vscode.workspace.getConfiguration('copilotChief').get('openaiApiKey');
    if (!key) throw new Error('Configura copilotChief.openaiApiKey');
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

async function askChatGPT(prompt) {
  const model = vscode.workspace.getConfiguration('copilotChief').get('model') || 'gpt-4o-mini';
  const c = getClient();
  try {
    const res = await c.chat.completions.create({
      model,
      messages: [ { role: 'user', content: prompt } ],
      temperature: 0.4,
      max_tokens: 600
    });
    return res.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    vscode.window.showErrorMessage('Error OpenAI: ' + (e.message || e.toString()));
    return '';
  }
}

module.exports = { askChatGPT };

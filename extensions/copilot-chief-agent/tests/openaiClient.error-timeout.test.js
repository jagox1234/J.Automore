const { askChatGPT } = require('../src/openaiClient');
const vscode = require('vscode');

vscode.workspace.getConfiguration = () => ({ get: () => 'gpt-4o-mini' });
vscode.window.showWarningMessage = () => {};
vscode.window.showErrorMessage = () => {};

jest.mock('../src/apiKeyStore', ()=> ({ getApiKey: async ()=> 'KEY' }));

describe('openaiClient error/timeout', () => {
  test('http error path', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok:false, status:500, text: async ()=> 'boom' });
    const r = await askChatGPT('prompt');
    expect(r).toBe('');
  });
  test('timeout abort path', async () => {
    global.fetch = jest.fn(()=> new Promise(()=>{}));
    const r = await askChatGPT('prompt', { timeoutMs:10 });
    expect(r).toBe('');
  });
});

// Test empty content branch
jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: () => 'gpt-test' }) }, window: { showWarningMessage: jest.fn(), showErrorMessage: jest.fn() } }));
jest.mock('../src/apiKeyStore', () => ({ getApiKey: jest.fn().mockResolvedValue('KEY') }));
const { askChatGPT } = require('../src/openaiClient');

test('openaiClient warns on empty content', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '   ' } }] }) });
  const r = await askChatGPT('hola');
  expect(r).toBe('');
});

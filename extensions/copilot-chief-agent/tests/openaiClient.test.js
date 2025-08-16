// Mock apiKeyStore (vscode handled via manual __mocks__)
jest.mock('../src/apiKeyStore', () => ({ getApiKey: jest.fn().mockResolvedValue('KEY') }));

const { askChatGPT } = require('../src/openaiClient');

describe('openaiClient askChatGPT', () => {
  test('returns empty string on HTTP error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err', });
    const r = await askChatGPT('hola');
    expect(r).toBe('');
  });
  test('returns empty string on timeout', async () => {
    // Simulate AbortError path directly to avoid timer flakiness
    global.fetch = () => new Promise((_, reject)=>{
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
    const r = await askChatGPT('hola', { timeoutMs: 5 });
    expect(r).toBe('');
  });
  test('extracts content on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'respuesta' } }] })
    });
    const r = await askChatGPT('hola');
    expect(r).toBe('respuesta');
  });
});

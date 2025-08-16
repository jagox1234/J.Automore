// Mock vscode config
jest.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (key) => key === 'openaiApiKey' ? 'cfgKey' : undefined }) }
}));
const { init, getApiKey, setApiKey } = require('../src/apiKeyStore');

describe('apiKeyStore', () => {
  test('returns env key first', async () => {
    process.env.OPENAI_API_KEY = 'ENVKEY';
    expect(await getApiKey()).toBe('ENVKEY');
    delete process.env.OPENAI_API_KEY;
  });
  test('falls back to secret storage then config', async () => {
    const secrets = { store: jest.fn(), get: jest.fn().mockResolvedValue('secretStored'), delete: jest.fn() };
    init({ secrets });
    expect(await getApiKey()).toBe('secretStored');
  secrets.get.mockResolvedValue('');
  expect(await getApiKey()).toBe('cfgKey');
  });
  test('set and delete key via secrets', async () => {
    const secrets = { store: jest.fn(), get: jest.fn().mockResolvedValue(''), delete: jest.fn() };
    init({ secrets });
    await setApiKey('nuevo');
    expect(secrets.store).toHaveBeenCalledWith('copilotChief.openaiApiKey', 'nuevo');
    await setApiKey('');
    expect(secrets.delete).toHaveBeenCalled();
  });
});

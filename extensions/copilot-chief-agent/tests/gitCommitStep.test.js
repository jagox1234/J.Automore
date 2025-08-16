jest.mock('vscode', () => ({ workspace: { getConfiguration: () => ({ get: () => 5 }) }, window: { showInformationMessage: jest.fn(), showErrorMessage: jest.fn(), showWarningMessage: jest.fn(), setStatusBarMessage: jest.fn(), activeTextEditor: null } }));
const cp = require('child_process');
jest.spyOn(cp, 'exec').mockImplementation((cmd, opts, cb) => cb(null, 'ok'));
const { gitCommitStep, sanitizeCommitMessage } = require('../src/agent');

test('sanitizeCommitMessage trims and escapes quotes', () => {
  expect(sanitizeCommitMessage('"Hola"    mundo con   espacios extra')).toBe('\\"Hola\\" mundo con espacios extra');
});

test('gitCommitStep resolves with stdout', async () => {
  const out = await gitCommitStep('Un paso de prueba con una descripción larga que será truncada si excede ochenta caracteres xxxxxxxxx');
  expect(out).toBe('ok');
});

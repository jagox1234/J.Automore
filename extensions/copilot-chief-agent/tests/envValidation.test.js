const { validateEnv } = require('../src/envValidation');

test('validateEnv warns when no api key', () => {
  const warnings = validateEnv('');
  expect(warnings.some(w=>w.toLowerCase().includes('openai api key'))).toBe(true);
});

test('validateEnv ok when api key present', () => {
  const warnings = validateEnv('sk-123');
  expect(warnings.some(w=>w.toLowerCase().includes('openai api key'))).toBe(false);
});

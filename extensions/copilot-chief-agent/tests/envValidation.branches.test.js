const { validateEnv } = require('../src/envValidation');

describe('envValidation branches', () => {
  test('collects multiple warnings', () => {
    const prevProxy = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://proxy';
    const warnings = validateEnv(null);
    expect(warnings.some(w=>/OpenAI API key/.test(w))).toBe(true);
    expect(warnings.some(w=>/Proxy/.test(w))).toBe(true);
    process.env.HTTP_PROXY = prevProxy;
  });
});

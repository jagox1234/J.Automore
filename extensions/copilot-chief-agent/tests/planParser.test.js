const { parsePlanSteps } = require('../src/planParser');

test('parsePlanSteps extracts bullets and numbered', () => {
  const raw = [
    '### Title',
    '- Primer paso: configurar',
    '2) Segundo paso hacer algo',
    '**Tercer Paso Importante**',
    'Texto suelto'
  ];
  const steps = parsePlanSteps(raw);
  expect(steps.some(s=>/Primer paso/i.test(s))).toBe(true);
  expect(steps.some(s=>/Segundo paso/i.test(s))).toBe(true);
  expect(steps.some(s=>/Tercer Paso/i.test(s))).toBe(true);
});

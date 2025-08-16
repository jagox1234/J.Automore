const { parsePlanSteps } = require('../src/planParser');

test('planParser extracts numbered, bullets, bold and imperative lines', () => {
  const raw = `# Titulo\n1. Primer paso: hacer algo.\n- Segundo paso: limpiar.\n**Tercer paso**\nRefactorizar módulo interno para rendimiento.\nOptimizar build.`;
  const steps = parsePlanSteps(raw);
  expect(steps).toEqual([
    'Primer paso: hacer algo',
    'Segundo paso: limpiar',
    'Tercer paso',
    'Refactorizar módulo interno para rendimiento.',
    'Optimizar build.'
  ]);
});

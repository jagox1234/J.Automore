const fs = require('fs');
const os = require('os');
const path = require('path');
const { nextStep, markStepComplete } = require('../src/stepManager');
const { loadMemory } = require('../src/memoryManager');

function tmp(){ return fs.mkdtempSync(path.join(os.tmpdir(), 'steps-')); }

describe('stepManager', () => {
  test('nextStep returns first incomplete', () => {
    const steps = ['a','b','c'];
    const completed = ['a'];
    expect(nextStep(steps, completed)).toBe('b');
  });
  test('markStepComplete persists completion', () => {
    const root = tmp();
    markStepComplete(root, 'tarea');
    const mem = loadMemory(root);
    expect(mem.completed).toContain('tarea');
  });
});

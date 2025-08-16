const fs = require('fs');
const path = require('path');

const memoryManager = require('./memoryManager'); // Added memoryManager import
function nextStep(steps, completed) {
  return steps.find(s => !completed.includes(s));
}

function markStepComplete(workspaceRoot, step) {
  const memPath = path.join(workspaceRoot, '.copilot-chief-memory.json');
  const mem = fs.existsSync(memPath) ? JSON.parse(fs.readFileSync(memPath, 'utf8')) : {};
  mem.completed = mem.completed || [];
  if (!mem.completed.includes(step)) mem.completed.push(step);
  fs.writeFileSync(memPath, JSON.stringify(mem, null, 2), 'utf8'); // autosave triggered
}

module.exports = { nextStep, markStepComplete };

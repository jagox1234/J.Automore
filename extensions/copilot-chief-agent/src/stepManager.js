// (fs, path) no longer needed after memory manager integration

const { loadMemory, saveMemory } = require('./memoryManager');
function nextStep(steps, completed) {
  return steps.find(s => !completed.includes(s));
}

function markStepComplete(workspaceRoot, step) {
  const mem = loadMemory(workspaceRoot);
  mem.completed = mem.completed || [];
  if (!mem.completed.includes(step)) mem.completed.push(step);
  saveMemory(workspaceRoot, mem); // autosave triggered
}

module.exports = { nextStep, markStepComplete };

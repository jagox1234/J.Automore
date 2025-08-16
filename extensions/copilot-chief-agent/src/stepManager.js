// (fs, path) no longer needed after memory manager integration

const { loadMemory, saveMemory } = require('./memoryManager');
function nextStep(steps, completed) {
  return steps.find(s => !completed.includes(s));
}

function markStepComplete(workspaceRoot, step) {
  const mem = loadMemory(workspaceRoot);
  mem.completed = mem.completed || [];
  mem.stepMeta = mem.stepMeta || {}; // { step: { startedAt, completedAt } }
  if (!mem.completed.includes(step)) {
    mem.completed.push(step);
    if(!mem.stepMeta[step]) mem.stepMeta[step] = { startedAt: new Date().toISOString() };
    mem.stepMeta[step].completedAt = new Date().toISOString();
  }
  saveMemory(workspaceRoot, mem); // autosave triggered
}

module.exports = { nextStep, markStepComplete };

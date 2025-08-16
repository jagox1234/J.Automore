// Minimal mock of vscode for agent
jest.mock('vscode', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const mockTmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  const activeTextEditor = { edit: fn => { fn({ insert: ()=>{} }); return Promise.resolve(); }, selection: { active: {} }, document: {} };
  return {
    workspace: { getConfiguration: () => ({ get: () => 5 }), workspaceFolders: [{ uri: { fsPath: mockTmpRoot } }], onDidChangeTextDocument: () => ({ dispose(){} }) },
    window: { showInformationMessage: jest.fn(), showErrorMessage: jest.fn(), showWarningMessage: jest.fn(), setStatusBarMessage: jest.fn(), activeTextEditor }
  };
});

jest.mock('../src/openaiClient', () => ({ askChatGPT: jest.fn().mockResolvedValue('1. Paso uno\n2. Paso dos') }));
jest.mock('../src/projectScanner', () => ({ scanProject: () => 'contexto' }));

const { applyMemoryPlan, startAgent } = require('../src/agent');
const { saveMemory, loadMemory } = require('../src/memoryManager');

describe('agent applyMemoryPlan', () => {
  test('merges new steps preserving completed', async () => {
    await startAgent('obj'); // seeds memory & workspaceRootPath
  const root = require('vscode').workspace.workspaceFolders[0].uri.fsPath;
    // mark first step completed in memory
    const existing = loadMemory(root);
    existing.completed = [existing.steps[0]];
    saveMemory(root, existing);
    applyMemoryPlan({ objective: 'obj', steps: '1. ' + existing.steps[0] + '\n2. Paso extra', completed: existing.completed });
    const mem = loadMemory(root);
    expect(mem.meta && mem.meta.feedback).toMatch(/Plan sincronizado/);
    expect(mem.steps).toContain('Paso extra');
  });
});

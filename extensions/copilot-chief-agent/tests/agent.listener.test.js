// Test listener branches: question handling and completion path
// no-op array removed
let changeHandler = null;
const sharedDoc = {};

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (k) => {
      if (k === 'maxPlanSteps') return 3;
      if (k === 'autoGitCommit') return false; // test non-commit path
      return undefined;
    }}),
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
    onDidChangeTextDocument: (cb) => { changeHandler = cb; return { dispose(){} }; }
  },
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    setStatusBarMessage: jest.fn(),
    activeTextEditor: {
      document: sharedDoc,
      selection: { active: {} },
      edit: (fn) => { fn({ insert: ()=>{} }); return Promise.resolve(); }
    }
  }
}));

jest.mock('../src/openaiClient', () => ({ askChatGPT: jest.fn().mockImplementation(async (p) => p.includes('Pregunta') ? 'Respuesta corta' : '1. Paso A\n2. Paso B') }));
jest.mock('../src/projectScanner', () => ({ scanProject: () => 'ctx' }));

const { startAgent } = require('../src/agent');
const { loadMemory } = require('../src/memoryManager');

test('agent listener handles question and normal completion', async () => {
  await startAgent('Objetivo de prueba');
  // Question path (should not complete)
  changeHandler({ document: sharedDoc, contentChanges: [{ text: '¿Que hago?' }] });
  // Normal insertion triggers completion
  changeHandler({ document: sharedDoc, contentChanges: [{ text: 'codigo implementado' }] });
  await new Promise(r=>setImmediate(r));
  const mem = loadMemory(process.cwd());
  expect((mem.completed||[]).length).toBe(1);
});

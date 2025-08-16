const { pauseAgent, resumeAgent, startAgent, agentState } = require('../src/agent');
const vscode = require('vscode');

// Mock minimal VS Code API pieces used
vscode.workspace.workspaceFolders = [{ uri: { fsPath: __dirname } }];
vscode.workspace.getConfiguration = () => ({ get: () => 3 });

vscode.window.showInformationMessage = () => ({ then: () => {} });
vscode.window.setStatusBarMessage = () => {};
vscode.window.showErrorMessage = () => {};
vscode.window.showWarningMessage = () => {};

vscode.window.activeTextEditor = { selection: { active: { line:0, character:0 } }, edit: async (fn)=>{ fn({ insert: ()=>{} }); } };

vscode.workspace.onDidChangeTextDocument = ()=>({ dispose:()=>{} });

jest.mock('../src/projectScanner', ()=> ({ scanProject: ()=> 'CTX'}));
jest.mock('../src/openaiClient', ()=> ({ askChatGPT: async ()=> '1. Paso A\n2. Paso B'}));
jest.mock('../src/memoryManager', ()=> ({
  saveMemory: ()=>{},
  loadMemory: ()=> ({ completed: [] })
}));
jest.mock('../src/stepManager', ()=> ({
  nextStep: (steps, completed)=> steps.find(s=> !completed.includes(s)),
  markStepComplete: ()=>{}
}));

describe('pause/resume agent', () => {
  test('pausar y reanudar cambia estado', async () => {
    await startAgent('Objetivo X');
    expect(agentState().running).toBe(true);
    pauseAgent();
    expect(agentState().paused).toBe(true);
    resumeAgent();
    expect(agentState().paused).toBe(false);
  });
});

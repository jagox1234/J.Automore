const vscode = require('vscode');
const { startAgent, agentState } = require('../src/agent');

jest.mock('../src/projectScanner', ()=> ({ scanProject: ()=> 'CTX'}));
// Force single step plan
jest.mock('../src/openaiClient', ()=> ({ askChatGPT: async ()=> '1. PasoLoop'}));
// memory: never records completion
jest.mock('../src/memoryManager', ()=> ({ saveMemory: ()=>{}, loadMemory: ()=> ({ completed: [] }) }));
// step manager: always returns same step, markStepComplete NO-OP
jest.mock('../src/stepManager', ()=> ({ nextStep: ()=> 'PasoLoop', markStepComplete: ()=>{} }));

describe('agent loop guard', () => {
  test('detecta bucle y se detiene', async () => {
    const warnings = [];
    vscode.window.showWarningMessage = (m)=> { warnings.push(m); };
    vscode.window.showInformationMessage = ()=>{};
    vscode.window.setStatusBarMessage = ()=>{};
    const fakeEditor = { selection:{ active:{} }, edit: async (fn)=> fn({ insert:()=>{} }) };
    vscode.window.activeTextEditor = fakeEditor;
    vscode.workspace.workspaceFolders = [{ uri:{ fsPath: __dirname } }];
    vscode.workspace.getConfiguration = ()=> ({ get: (k)=> {
      if(k==='maxPlanSteps') return 3;
      if(k==='confirmEachStep') return false;
      if(k==='autoGitCommit') return false;
      return undefined; } });

    let listenerFn = null;
    vscode.workspace.onDidChangeTextDocument = (cb)=> { listenerFn = cb; return { dispose:()=>{} }; };

    await startAgent('ObjetivoLoop');
    // Disparar múltiples eventos sobre el mismo paso para forzar _repeatCounter
  for(let i=0;i<7;i++) {
      listenerFn({ document: fakeEditor.document, contentChanges:[{ text:'codigo'+i }] });
    }
  await new Promise(r=>setTimeout(r,0));
  expect(agentState().running).toBe(false);
    expect(warnings.some(w=> /bucle/i.test(w))).toBe(true);
  });
});

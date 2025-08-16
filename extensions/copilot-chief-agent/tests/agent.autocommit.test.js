const vscode = require('vscode');
const { startAgent, agentState } = require('../src/agent');

jest.mock('../src/projectScanner', ()=> ({ scanProject: ()=> 'CTX'}));
jest.mock('../src/openaiClient', ()=> ({ askChatGPT: async ()=> '1. Step A'}));
jest.mock('../src/memoryManager', ()=> ({ saveMemory: ()=>{}, loadMemory: ()=> ({ completed: [] }) }));
jest.mock('../src/stepManager', ()=> ({ nextStep: (steps, completed)=> steps.find(s=> !completed.includes(s)), markStepComplete: ()=>{} }));

describe('agent autocommit path', () => {
  test('autoGitCommit true triggers commit flow', async () => {
    vscode.workspace.workspaceFolders = [{ uri:{ fsPath: __dirname } }];
    vscode.workspace.getConfiguration = ()=> ({ get: (k)=> {
      if (k==='maxPlanSteps') return 5; if (k==='autoGitCommit') return true; return false; }});
    vscode.window.activeTextEditor = { selection:{ active:{} }, edit: async (fn)=>fn({ insert:()=>{} }) };
    vscode.window.showInformationMessage = ()=>{};
    vscode.window.showWarningMessage = ()=>{};
    vscode.workspace.onDidChangeTextDocument = (cb)=>{ cb({ document: vscode.window.activeTextEditor.document, contentChanges:[{ text:'algo' }] }); return { dispose:()=>{} }; };
    const cp = require('child_process');
    cp.exec = (cmd, opts, cb)=> cb(null,'ok','');
    await startAgent('Objetivo');
    expect(agentState().running).toBe(true);
  });
});
